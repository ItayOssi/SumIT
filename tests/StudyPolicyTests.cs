using System;
using System.IO;
using System.Linq;
class StudyPolicyTests
{
    static void Check(bool value, string name) { if (!value) throw new Exception(name); Console.WriteLine("PASS " + name); }
    static string Card(string body) { return "<details class='q' id='use-1'><summary>Question</summary><div class='qbody'>" + body + "</div></details>"; }
    [STAThread] static void Main(string[] args)
    {
        string statement = "<section class='question-statement' data-source='sheet.pdf, p1, Q1'><h4>Question</h4><p>A train moves at 34 m/s. Find its distance after 10 seconds.</p></section>";
        Check(HitStudent.MissingQuestionStatements(Card(statement + "<details class='reveal'><summary>Solution</summary>340 m</details>")).Count == 0, "complete sourced statement before solution accepted");
        Check(HitStudent.MissingQuestionStatements(Card("<p>Hint only</p><details><summary>Solution</summary>340 m</details>")).Count == 1, "solution without question rejected");
        Check(HitStudent.MissingQuestionStatements(Card("<details><summary>Solution</summary>" + statement + "</details>")).Count == 1, "statement hidden inside solution rejected");
        Check(HitStudent.MissingQuestionStatements(Card(statement.Replace("data-source='sheet.pdf, p1, Q1'", ""))).Count == 1, "missing source rejected");
        Check(HitStudent.MissingQuestionStatements(Card("<!--" + statement + "-->")).Count == 1, "comment cannot satisfy question check");
        Check(HitStudent.MissingQuestionStatements(Card(statement) + Card("<p>Only answer</p>")).Count == 1, "every subpart checked independently");
        Check(HitStudent.MissingQuestionStatements("<h1>Summary without exercises</h1>").Count == 1, "missing exercise section rejected");
        if (args.Length > 0) Check(HitStudent.MissingQuestionStatements(File.ReadAllText(args[0])).Count == 0, "real physics homework passes structure check");
    }
}
