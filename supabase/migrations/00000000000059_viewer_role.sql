-- מיגרציה 59: תפקיד "צפייה בלבד" (viewer) למשתמשי הדגמה - לידים שמתנסים
-- במערכת מול נתונים חיים בלי אפשרות לשנות אותם. חסימת הכתיבה בפועל נאכפת
-- בצד השרת (middleware blockViewerWrites), לא ברמת ה-DB.
alter type user_role add value 'viewer';
