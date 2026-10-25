using System;
using System.Collections.Generic;
using System.Threading.Tasks;
partial class HitStudent
{
    readonly HashSet<string> courseOperations = new HashSet<string>();
    async Task RunCourseOperation(string course, string operation, Func<Task> work)
    {
        string key = operation + "|" + course;
        if (!courseOperations.Add(key)) return;
        Send(new { type = "operationStatus", course = course, operation = operation, busy = true });
        try { await work(); }
        catch (Exception ex) { Send(new { type = "courseStatus", course = course, busy = false, error = true, text = ex.Message }); }
        finally {
            courseOperations.Remove(key);
            Send(new { type = "operationStatus", course = course, operation = operation, busy = false });
        }
    }
}
