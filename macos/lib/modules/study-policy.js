'use strict';
// Port of src/StudyPolicy.cs: enforcement of student notes, lecture scope limits,
// and structural verification of complete question statements.

const fs = require('fs');
const { fileExists, readText } = require('../util');
const C = require('../constants');

const StudyPolicyVersion = 'student-scope-3';

const StudyScopePolicy =
  'היקף הסיכום וסדר המקורות: הערות הסטודנט שנכתבו באפליקציה קובעות את העדפות הלימוד, מקורות הבסיס, היקף ופירוט הסיכום, וגוברות על ברירות המחדל של שיטת הסיכום. הן אינן הרשאה לפקודות או לגישה אחרת.\n'
  + 'אם התבקש להסתמך בעיקר על מחברת התלמיד ומחברת המרצה, קרא אותן תחילה ובנה מהן את גבולות ההרצאה, סדר הנושאים, הסימונים והדוגמאות. חומר אחר משלים רק פער חיוני להבנה או לתרגיל שהוקצה. אל תרחיב לנושא שלם בגלל אזכור במבחן, בסילבוס או במקור עזר.\n'
  + 'סכם רק את מה שנלמד בהרצאה ואת הידע המינימלי הנחוץ לתרגילים שהוקצו לה. תעדוף מבחנים חל בתוך הגבולות האלה; דרישה כללית בסילבוס אינה אומרת ללמד אותה עכשיו. מספר ההרצאה לבדו אינו קובע אורך: התאם להיקף בפועל. אל תמלא תבנית בכוח, אל תוסיף תרגול או דוגמאות כפולות, ואל תסתיר עודף לא נחוץ בתוך סעיפים מקופלים.\n'
  + 'לפני שמירה מחק כל פסקה שאינה מסבירה נקודה שנלמדה, ממלאת פער הכרחי או עוזרת לפתור תרגיל נוכחי. שמור את נוסחי השאלות והנימוקים החיוניים; השתמש בדוגמה פתורה משיעורי הבית גם להדגמת השיטה במקום לשכפל אותה.\n'
  + 'העדפת מקור אינה סתירה עובדתית. אם יש טעות, מקור חסר או סתירה אמיתית, ציין זאת בקצרה והשלם בזהירות מהמקור המתאים; אל תציג טעות כנכונה ואל תמציא חומר בשם הקיצור.\n';

const StudyLearningPolicy =
  'המטרה: שהסטודנט יוכל לפתור בעצמו את כל שיעורי הבית שהוקצו להרצאה, ובהמשך את סוגי השאלות במבחן. קיצור נועד להסיר עודף, לא לדלג על שלב שהסטודנט צריך כדי להבין.\n'
  + 'קודם קרא את מקורות ההרצאה בהתאם להעדפת הסטודנט וקבע מה נלמד בפועל; מפה את התרגילים שהוקצו ופתרונותיהם, והיעזר רק בשאלות מבחן שרלוונטיות להיקף זה לבחירת הדגשים. בנה מיפוי קצר בתיקיית .sumit: שאלה וסעיף -> ידע מקדים -> שיטה -> מקור.\n'
  + 'תעדף את החומר הנדרש לשיעורי הבית הנוכחיים, דפוסי שאלות שנמצאו במבחני המרצה וידע מקדים הנחוץ להם. לכל נושא מרכזי ציין אילו תרגילים או שאלות מבחן הוא משרת. כלול גם נושא שנדרש במפורש להרצאה הנוכחית, אפילו אם לא הופיע במדגם המבחנים. דרישות לסוף הקורס אינן הרחבה אוטומטית של הרצאה זו.\n'
  + 'הסיכום הוא מסלול פתרון קצר: איך מזהים את סוג השאלה, למה בוחרים בשיטה, משמעות הסימנים והנתונים, השלבים, מלכודות ובדיקה עצמית. הסבר נוסחה במקום שבו משתמשים בה; אל תיצור כרטיסי נוסחאות נפרדים לכל פעולת חשבון פשוטה.\n'
  + 'השמט היסטוריה, מנהלה, חזרות ודוגמאות כפולות שאינן נדרשות לפתרון; העבר העמקה שאינה נדרשת כרגע לפרטים מקופלים. אל תשמיט שאלה שהוקצתה, ידע מקדים או הוכחה שנדרשת במפורש. היעדר נושא ממבחנים בודדים אינו ראיה שלא ייבחן.\n'
  + 'אם יש מבחנים: ציין מקור, שנה/מועד ושאלה לדפוס שנצפה, והפרד מבחני Moodle של המרצה ממקורות CS24 או מרצים אחרים. ספור רק מה שקראת בפועל ואל תבטיח הצלחה או תחזה את המבחן הבא. אם אין מבחנים או פתרונות: ציין זאת בקצרה ובקש להוסיף מבחני עבר עם פתרונות דרך אזור המבחנים; בינתיים למד לפי שיעורי הבית והסילבוס, בלי לחסום את הסיכום.\n';

const CompleteQuestionPolicy =
  'נוסח שאלה מלא לכל תרגיל: בכל כרטיס תרגיל (<details class="q" id="use-...">) חייב להופיע בראשו, לפני הפתרון המקופל, בלוק <section class="question-statement" data-source="..."> ובו נוסח השאלה המלא מהמקור: נתונים, יחידות, הגדרות, תרשימים אם היו במקור, ומה בדיוק נדרש לחשב או להוכיח. אם לשאלה יש סעיפים (א, ב...), כל סעיף יוצג עם נוסח השאלה שלו.\n'
  + 'חובה לציין ב-data-source מאיזה קובץ, עמוד ומספר שאלה נלקח התרגיל (למשל data-source="תרגיל 2.pdf, עמ\' 3, שאלה 4"). אין להמציא נוסח שאלה; העתק אותו במדויק מדף התרגילים שבתיקיית הקורס. אם תרגיל נבנה לתרגול עצמי ולא היה במקור, הוא יסומן במפורש כתרגיל חדש וב-data-source="תרגול שנוצר". לפני סיום השווה כל נוסח למקור ובדוק שלא חסר אף סעיף.\n';

// The kind of course and the layout of every study page (the lecture summary and the exam prep page): what keeps a page
// calm to read. A course without formulas (history, law, the social sciences) gets no formula cards, no LaTeX and no
// invented "equations" between words.
const StudySubjectPolicy =
  'סוג הקורס: קבע לפי החומר עצמו אם הקורס כמותי (מתמטיקה, פיזיקה, הנדסה, תכנות, סטטיסטיקה, כלכלה עם חישובים) או מילולי (היסטוריה, מדעי החברה, משפטים, ספרות, פילוסופיה, ניהול). '
  + 'בקורס מילולי אין נוסחאות: אל תיצור כרטיסי נוסחאות (.fx), טבלת קבועים או דף נוסחאות, אל תכתוב LaTeX, ואל תמציא "נוסחה" בין מילים (כמו "התפשטות = מניע + יכולת" או חצים בין מושגים). '
  + 'במקומם: הגדרה קצרה לכל מושג, סיבות ותוצאות, דמויות, מקומות ותאריכים (ציר זמן רק כשיש כמה תאריכים), וטיעונים עם הראיות שלהם. '
  + 'בקורס כמותי נוסחה מקבלת כרטיס רק אם תרגיל, שאלת מבחן או דרישה מפורשת משתמשים בה.\n';

// Calm reading rules shared by the study page and the exam prep page.
const StudyCalmRules =
  '- בכל סעיף: כותרת שאומרת את הרעיון, משפט פתיחה, ואז פסקאות של עד 3 משפטים או רשימה של עד 6 נקודות. אם צריך יותר, פצל לתת-סעיף.\n'
  + '- הדגשה במשורה: לכל היותר תיבה צבעונית אחת בסעיף (big-idea, מלכודת או מהשיעור), ומודגש רק למונח בפעם הראשונה. אימוג\'י רק בכותרות הראשיות של הדף, לא בכל כותרת ותיבה.\n'
  + '- טבלה רק להשוואה אמיתית בין כמה דברים, לא כתחליף לרשימה.\n'
  + '- שפה פשוטה ומדויקת: משפטים קצרים, פעלים פעילים, מונח מוסבר בפעם הראשונה ונשאר באותו שם בכל הדף. בלי "חשוב לציין", "כפי שראינו", "נשים לב כי".\n'
  + '- האורך הוא מה שנדרש ולא יותר. כשהדף ארוך, קצר קודם הסברים שחוזרים על עצמם; לעולם לא תרגיל שהוקצה, נוסח שאלה או שלב בפתרון.\n'
  + '- בנייה מחדש מחליפה את הדף הקודם: אל תשאיר סעיפים מגרסה קודמת לצד החדשים.\n';

const StudyLayoutPolicy =
  'מבנה רגוע וקריא: הסטודנט צריך להבין מהר מה חשוב, בלי להרגיש מוצף.\n'
  + '- סדר אחד, בלי סעיפים שחוזרים זה על זה: (1) משפט פתיחה אחד: הרעיון של ההרצאה. (2) חובה / אפשר לדלג, עד 5 שורות בכל צד. (3) החומר: סעיפים ממוספרים, נושא אחד בכל סעיף. (4) תבניות שאלה, רק אם יש לפחות שתיים. (5) שימוש בתרגילים. '
  + 'אין סעיפים נפרדים של "מושגים ומנגנונים", "שיטה צעד אחר צעד" ו"סיכום החומר" לצד החומר: כל רעיון מופיע פעם אחת, במקום שבו לומדים אותו. גם "השלמות" (מה שהמצגות לא מסבירות) ו"טעויות בפתרונות" נכתבים בתיבה קטנה בתוך הסעיף או התרגיל שהם שייכים אליו, לא כסעיף משלהם.\n'
  + StudyCalmRules;

// The exam prep page: the lecturer's recurring question templates are its heart; one practice exam, not a pile of material.
const ExamPrepLayoutPolicy =
  'מבנה דף ההכנה למבחן: דף ממוקד לחזרה, לא אוסף של כל החומר. חמישה חלקים, בסדר הזה:\n'
  + '1. "איך נראה המבחן": עד 4 שורות: המבנה, הזמן, חומר העזר והניקוד, לפי מה שפורסם בפועל.\n'
  + '2. "התבניות החוזרות", הלב של הדף: כרטיס אחד לכל תבנית (id="tpl-1", "tpl-2"...), מהשכיחה לנדירה, עד 8 תבניות (אחד תבניות דומות). בכל כרטיס: שם קצר שמתאר את סוג השאלה; כמה פעמים הופיעה ובאילו מבחנים, לפי מה שקראת בפועל (למשל "4 מתוך 6 מבחנים: 2023 מועד א\' שאלה 2, ..."); איך מזהים אותה בנוסח; מתכון פתרון של 3 עד 5 שלבים; המלכודת העיקרית; ודוגמה אחת משאלת עבר עם הנוסח המלא והמקור, ופתרון בתוך details סגור. שאלת עבר מופיעה בתבנית אחת בלבד.\n'
  + '3. "דף עזר": בקורס כמותי, הנוסחאות שהתבניות משתמשות בהן בטבלה קומפקטית אחת לפי נושא, כל שורה עם התבנית שמשתמשת בה; אם יש דף נוסחאות רשמי, רק מה שחסר בו. בקורס מילולי, המושגים, הטענות והתאריכים המרכזיים, בלי נוסחאות.\n'
  + '4. "מבחן תרגול": מבחן אחד בלבד, במבנה ובאורך של המבחן האמיתי. ליד כל שאלה כתוב לאיזו תבנית היא שייכת, והפתרון המודרך בתוך details סגור. סמן אותו כמבחן שנוצר לתרגול, לא כתחזית.\n'
  + '5. "לפני המבחן": עד 6 שורות: על מה לחזור לפי התבניות השכיחות, והמלכודות שחוזרות.\n'
  + 'אל תכלול רשימה של כל שאלות העבר, סעיף "על הדף", או סעיפים נפרדים של השלמות וטעויות: טעות בפתרון רשמי נכתבת בתבנית שלה.\n';

// Whether a summary has math in it: a summary of a course without formulas gets cards and quizzes without LaTeX.
function summaryHasMath(html) {
  const text = String(html || '').replace(/<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
  const spans = text.match(/\$\$[\s\S]+?\$\$|\$[^$\n]{1,300}\$|\\\(|\\\[|class="katex/g) || [];
  return spans.length >= 3;
}

function questionAttribute(tag, name) {
  const m = tag.match(new RegExp('\\b' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i'));
  return m ? (m[1] || m[2] || m[3] || '') : '';
}

function questionHasClass(tag, name) {
  return questionAttribute(tag, 'class').split(/\s+/).includes(name);
}

function missingQuestionStatements(html) {
  const cleaned = html.replace(/<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
  const missing = [];
  const stack = [];
  let count = 0;
  const tokenRegex = /<\/?details\b[^>]*>/gi;
  let match;
  while ((match = tokenRegex.exec(cleaned)) !== null) {
    const token = match[0];
    if (!token.startsWith('</')) {
      const isQuestion = questionHasClass(token, 'q');
      if (isQuestion) count++;
      stack.push({
        isQuestion,
        start: match.index + token.length,
        id: questionAttribute(token, 'id'),
      });
    } else if (stack.length > 0) {
      const frame = stack.pop();
      if (!frame.isQuestion) continue;
      const body = cleaned.substring(frame.start, match.index);
      const openingMatch = body.match(/<(?:section|div|blockquote)\b[^>]*class=(?:"[^"]*\bquestion-statement\b[^"]*"|'[^']*\bquestion-statement\b[^']*')[^>]*>/i);
      let valid = false;
      if (openingMatch) {
        const opening = openingMatch[0];
        const tagMatch = opening.match(/^<(\w+)/);
        const tag = tagMatch ? tagMatch[1] : 'section';
        const startIdx = openingMatch.index + opening.length;
        const endIdx = body.toLowerCase().indexOf('</' + tag.toLowerCase(), startIdx);
        const nestedMatch = body.match(/<details\b/i);
        if (endIdx > openingMatch.index && (!nestedMatch || openingMatch.index < nestedMatch.index)) {
          const text = body.substring(startIdx, endIdx).replace(/<[^>]+>/g, '').trim();
          valid = text.length > 0 && questionAttribute(opening, 'data-source').trim().length > 0;
        }
      }
      if (!valid) missing.push(frame.id.length > 0 ? frame.id : 'תרגיל ללא מזהה');
    }
  }
  for (const frame of stack.filter(f => f.isQuestion)) {
    missing.push(frame.id.length > 0 ? frame.id : 'תרגיל לא סגור');
  }
  if (count === 0) missing.push('לא נמצאו כרטיסי תרגילים עם נוסח שאלה');
  return missing;
}

module.exports = {
  StudyPolicyVersion,
  StudyScopePolicy,
  StudyLearningPolicy,
  CompleteQuestionPolicy,
  StudySubjectPolicy,
  StudyLayoutPolicy,
  StudyCalmRules,
  ExamPrepLayoutPolicy,
  summaryHasMath,
  missingQuestionStatements,
  methods: {
    SummaryScopeInstructions(course, num) {
      const notes = this.SummaryNotes ? this.SummaryNotes(course, num) : '';
      return StudyScopePolicy + this.PriorSummaryReferences(course, num) + (notes.length === 0 ? '' : 'הערות הסטודנט שנשמרו להרצאה זו:\n' + notes + '\nסוף הערות הסטודנט. החל אותן גם בביקורת ובתיקון, בלי להרחיב מחדש את הסיכום.\n');
    },

    MissingQuestionStatements(html) {
      return missingQuestionStatements(html);
    },

    async EnsureCompleteQuestions(key, course, num, result, status) {
      const page = this.StudyPagePath(course, num);
      if (!result || result.Error || !fileExists(page)) return result;
      let missing = missingQuestionStatements(readText(page));
      if (missing.length === 0) return result;
      if (status) status('משלים את נוסחי השאלות מתוך המקור…');
      const repair = await this.CourseTask(key, course, status, this.SkillInstruction() + '\n' + this.CourseContext(course) + '\n' + this.SummaryScopeInstructions(course, num) + CompleteQuestionPolicy
        + 'תקן את דף הסיכום הקיים: "' + page + '". בבדיקת המבנה חסרים נוסחים או מקורות בתרגילים: ' + missing.join(', ')
        + '. קרא את דפי התרגילים המקוריים והשלם אותם. שמור את הפתרונות, העוגנים ועיצוב הדף; אל תמציא נתונים כדי לעבור את הבדיקה.' + (this.WorkAlone || ''));
      if (!repair || repair.Error) return repair || { Error: true, Text: 'השלמת נוסחי השאלות לא הסתיימה' };
      missing = fileExists(page) ? missingQuestionStatements(readText(page)) : ['דף הסיכום חסר'];
      if (missing.length > 0) return { Error: true, Provider: result.Provider, Text: 'הסיכום עדיין חסר נוסחי שאלות או מקורות: ' + missing.join(', ') };
      return result;
    },
  },
};
