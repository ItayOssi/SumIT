// sumit-audio: records a live call for "שיחה חיה" (macOS only, live-notes.js). It hears both sides of the call:
// the Mac's own output (everyone else in Zoom, Teams or Meet), through a Core Audio process tap (macOS 14.2+), and the
// microphone (the student). Both are mixed to one 16 kHz mono stream and written as FLAC parts of a few minutes each,
// so a crash loses one part at most. It never sends anything anywhere; the app transcribes the parts and deletes them.
//
//   sumit-audio check                          -> {"event":"check","system":true,"mic":"granted|denied|undetermined"}
//   sumit-audio record <dir> [seconds] [nomic] -> part_001.flac, part_002.flac ... in <dir>
//
// Events are JSON lines on stdout: started, part {file, seconds}, level {t, sys, mic}, warn {what}, error {what, status},
// stopped. It stops on "stop" on stdin, on the end of stdin (the app is gone) or on SIGTERM/SIGINT, and closes the last part.
import Foundation
import CoreAudio
import AVFoundation

setvbuf(stdout, nil, _IOLBF, 0)
func emit(_ o: [String: Any]) {
  if let d = try? JSONSerialization.data(withJSONObject: o), let s = String(data: d, encoding: .utf8) { print(s) }
}
let args = CommandLine.arguments
let rate = 16000.0
let mono = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: rate, channels: 1, interleaved: false)!

func micStatus() -> String {
  switch AVCaptureDevice.authorizationStatus(for: .audio) {
  case .authorized: return "granted"
  case .denied, .restricted: return "denied"
  default: return "undetermined"
  }
}
func systemTapAvailable() -> Bool { if #available(macOS 14.2, *) { return true } else { return false } }

if args.count < 2 || args[1] == "check" {
  emit(["event": "check", "system": systemTapAvailable(), "mic": micStatus()])
  exit(0)
}
guard args[1] == "record", args.count >= 3 else { emit(["event": "error", "what": "usage"]); exit(2) }
let dir = URL(fileURLWithPath: args[2], isDirectory: true)
let partSeconds = args.count >= 4 ? max(10, Double(args[3]) ?? 240) : 240
let useMic = !args.contains("nomic")
try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)

// Samples waiting to be mixed, one queue per source, already at 16 kHz mono.
final class Source {
  let lock = NSLock()
  var samples: [Float] = []
  var total = 0
  var sum2: Double = 0, n = 0
  func push(_ b: AVAudioPCMBuffer) {
    guard let p = b.floatChannelData?[0] else { return }
    let c = Int(b.frameLength)
    lock.lock()
    samples.append(contentsOf: UnsafeBufferPointer(start: p, count: c))
    total += c
    for i in 0..<c { sum2 += Double(p[i] * p[i]) }
    n += c
    lock.unlock()
  }
  func take(_ k: Int) -> [Float] {
    lock.lock(); defer { lock.unlock() }
    let m = min(k, samples.count)
    let out = Array(samples.prefix(m)); samples.removeFirst(m)
    return out
  }
  var count: Int { lock.lock(); defer { lock.unlock() }; return samples.count }
  func level() -> Double { lock.lock(); defer { lock.unlock() }; let r = n > 0 ? (sum2 / Double(n)).squareRoot() : 0; sum2 = 0; n = 0; return r }
}

// Converts any buffer to 16 kHz mono and hands it to the source.
final class Converter {
  let conv: AVAudioConverter
  let src: Source
  init?(from: AVAudioFormat, to src: Source) {
    guard let c = AVAudioConverter(from: from, to: mono) else { return nil }
    conv = c; self.src = src
  }
  func feed(_ b: AVAudioPCMBuffer) {
    let cap = AVAudioFrameCount(Double(b.frameLength) * rate / b.format.sampleRate) + 64
    guard let out = AVAudioPCMBuffer(pcmFormat: mono, frameCapacity: cap) else { return }
    var given = false
    var err: NSError?
    conv.convert(to: out, error: &err) { _, status in
      if given { status.pointee = .noDataNow; return nil }
      given = true; status.pointee = .haveData; return b
    }
    if out.frameLength > 0 { src.push(out) }
  }
}

let sys = Source(), mic = Source()
var sysOn = false, micOn = false
var sysConv: Converter?, micConv: Converter?

// The Mac's output: a private global tap on the default output device, through a private aggregate device.
var tapID = AudioObjectID(kAudioObjectUnknown), aggID = AudioObjectID(0)
var procID: AudioDeviceIOProcID?
func prop<T>(_ obj: AudioObjectID, _ sel: AudioObjectPropertySelector, _ v: inout T) -> OSStatus {
  var a = AudioObjectPropertyAddress(mSelector: sel, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
  var size = UInt32(MemoryLayout<T>.size)
  return AudioObjectGetPropertyData(obj, &a, 0, nil, &size, &v)
}
func startSystem() -> String? {
  guard #available(macOS 14.2, *) else { return "macos" }
  let desc = CATapDescription(stereoGlobalTapButExcludeProcesses: [])
  desc.uuid = UUID(); desc.muteBehavior = .unmuted; desc.isPrivate = true; desc.name = "SumIT"
  var st = AudioHardwareCreateProcessTap(desc, &tapID); if st != noErr { return "tap \(st)" }
  var asbd = AudioStreamBasicDescription()
  st = prop(tapID, kAudioTapPropertyFormat, &asbd); if st != noErr { return "format \(st)" }
  var outDev = AudioObjectID(0)
  st = prop(AudioObjectID(kAudioObjectSystemObject), kAudioHardwarePropertyDefaultSystemOutputDevice, &outDev); if st != noErr { return "output \(st)" }
  var uid: CFString = "" as CFString
  st = prop(outDev, kAudioDevicePropertyDeviceUID, &uid); if st != noErr { return "uid \(st)" }
  let agg: [String: Any] = [
    kAudioAggregateDeviceNameKey: "SumIT", kAudioAggregateDeviceUIDKey: UUID().uuidString,
    kAudioAggregateDeviceMainSubDeviceKey: uid as String, kAudioAggregateDeviceIsPrivateKey: true,
    kAudioAggregateDeviceIsStackedKey: false, kAudioAggregateDeviceTapAutoStartKey: true,
    kAudioAggregateDeviceSubDeviceListKey: [[kAudioSubDeviceUIDKey: uid as String]],
    kAudioAggregateDeviceTapListKey: [[kAudioSubTapDriftCompensationKey: true, kAudioSubTapUIDKey: desc.uuid.uuidString]],
  ]
  st = AudioHardwareCreateAggregateDevice(agg as CFDictionary, &aggID); if st != noErr { return "aggregate \(st)" }
  guard let fmt = AVAudioFormat(streamDescription: &asbd), let c = Converter(from: fmt, to: sys) else { return "converter" }
  sysConv = c
  st = AudioDeviceCreateIOProcIDWithBlock(&procID, aggID, DispatchQueue(label: "sys")) { _, inData, _, _, _ in
    if let b = AVAudioPCMBuffer(pcmFormat: fmt, bufferListNoCopy: inData, deallocator: nil) { sysConv?.feed(b) }
  }
  if st != noErr { return "ioproc \(st)" }
  st = AudioDeviceStart(aggID, procID); if st != noErr { return "start \(st)" }
  return nil
}
func stopSystem() {
  if aggID != 0, let p = procID { AudioDeviceStop(aggID, p); AudioDeviceDestroyIOProcID(aggID, p) }
  if aggID != 0 { AudioHardwareDestroyAggregateDevice(aggID) }
  if #available(macOS 14.2, *), tapID != AudioObjectID(kAudioObjectUnknown) { AudioHardwareDestroyProcessTap(tapID) }
}

// The microphone, through AVAudioEngine.
let engine = AVAudioEngine()
func startMic() -> String? {
  let sem = DispatchSemaphore(value: 0)
  var ok = false
  AVCaptureDevice.requestAccess(for: .audio) { g in ok = g; sem.signal() }
  sem.wait()
  if !ok { return "denied" }
  let input = engine.inputNode
  // No voice processing (echo cancellation): with it on, the output tap gets nothing. Without headphones the call
  // is heard twice, a moment apart, which the transcription handles.
  let fmt = input.outputFormat(forBus: 0)
  if fmt.sampleRate == 0 || fmt.channelCount == 0 { return "no input" }
  guard let c = Converter(from: fmt, to: mic) else { return "converter" }
  micConv = c
  input.installTap(onBus: 0, bufferSize: 4096, format: fmt) { b, _ in micConv?.feed(b) }
  do { try engine.start() } catch { return "start \(error.localizedDescription)" }
  return nil
}

// The parts on disk.
var file: AVAudioFile?
var part = 0, partFrames = 0, written = 0
let flac: [String: Any] = [AVFormatIDKey: kAudioFormatFLAC, AVSampleRateKey: rate, AVNumberOfChannelsKey: 1]
func partURL(_ i: Int) -> URL { dir.appendingPathComponent(String(format: "part_%03d.flac", i)) }
func closePart() {
  guard file != nil else { return }
  file = nil
  emit(["event": "part", "file": partURL(part).path, "seconds": Double(partFrames) / rate])
}
func write(_ s: [Float]) {
  if s.isEmpty { return }
  if file == nil {
    part += 1; partFrames = 0
    do { file = try AVAudioFile(forWriting: partURL(part), settings: flac, commonFormat: .pcmFormatFloat32, interleaved: false) }
    catch { emit(["event": "error", "what": "file", "status": error.localizedDescription]); return }
  }
  guard let b = AVAudioPCMBuffer(pcmFormat: mono, frameCapacity: AVAudioFrameCount(s.count)) else { return }
  b.frameLength = AVAudioFrameCount(s.count)
  s.withUnsafeBufferPointer { p in b.floatChannelData![0].update(from: p.baseAddress!, count: s.count) }
  do { try file!.write(from: b) } catch { emit(["event": "error", "what": "write", "status": error.localizedDescription]) }
  partFrames += s.count; written += s.count
  if Double(partFrames) >= partSeconds * rate { closePart() }
}

// Mixes what both sources have. A source that falls more than a second behind (or is silent) is padded with zeros.
let lagLimit = Int(rate)
func mix(final: Bool) {
  let a = sysOn ? sys.count : 0, b = micOn ? mic.count : 0
  var k: Int
  if sysOn && micOn { k = min(a, b); if max(a, b) - k > lagLimit || final { k = max(a, b) } } else { k = max(a, b) }
  if k <= 0 { return }
  let x = sysOn ? sys.take(k) : [], y = micOn ? mic.take(k) : []
  var out = [Float](repeating: 0, count: k)
  for i in 0..<k {
    let v = (i < x.count ? x[i] : 0) + (i < y.count ? y[i] : 0)
    out[i] = max(-1, min(1, v))
  }
  write(out)
}

if let e = startSystem() { emit(["event": "warn", "what": "system", "status": e]) } else { sysOn = true }
if useMic { if let e = startMic() { emit(["event": "warn", "what": "mic", "status": e]) } else { micOn = true } }
if !sysOn && !micOn { emit(["event": "error", "what": "nothing to record"]); exit(1) }
emit(["event": "started", "system": sysOn, "mic": micOn, "part": partSeconds])

var stopping = false
let q = DispatchQueue(label: "mix")
func stop() {
  q.async {
    if stopping { return }
    stopping = true
    if micOn { engine.inputNode.removeTap(onBus: 0); engine.stop() }
    if sysOn { stopSystem() }
    mix(final: true)
    closePart()
    emit(["event": "stopped", "seconds": Double(written) / rate])
    exit(0)
  }
}
let timer = DispatchSource.makeTimerSource(queue: q)
var ticks = 0
timer.schedule(deadline: .now() + 0.25, repeating: 0.25)
timer.setEventHandler {
  if stopping { return }
  mix(final: false)
  ticks += 1
  if ticks % 2 == 0 { emit(["event": "level", "t": Double(written) / rate, "sys": sysOn ? sys.level() : 0, "mic": micOn ? mic.level() : 0]) }
  // The tap gives nothing at all when macOS has not allowed the app to hear other apps.
  if ticks == 16 && sysOn && sys.total == 0 { emit(["event": "warn", "what": "system", "status": "silent"]) }
}
timer.resume()
var sigSources: [DispatchSourceSignal] = []
for s in [SIGTERM, SIGINT] {
  signal(s, SIG_IGN)
  let src = DispatchSource.makeSignalSource(signal: s, queue: q)
  src.setEventHandler { stop() }
  src.resume()
  sigSources.append(src)
}
DispatchQueue.global().async {
  while let line = readLine() { if line.trimmingCharacters(in: .whitespaces) == "stop" { break } }
  stop()
}
dispatchMain()
