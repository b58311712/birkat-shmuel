# העלאת מטבח החסד לשרת (חינם)

הארכיטקטורה: **פרונט ב-Vercel · שרת ב-Render · מסד ב-Supabase (כבר קיים)**.

## סדר הפעולות

### 1. דחיפת הקוד ל-GitHub
כבר בוצע — הקוד ב-repo הפרטי שלך.

### 2. העלאת השרת ל-Render
1. היכנס ל-[render.com](https://render.com) והתחבר עם GitHub.
2. **New → Blueprint** ובחר את ה-repo. Render יקרא את `render.yaml` אוטומטית.
3. מלא את משתני הסביבה הסודיים (מתוך `server/.env` המקומי):
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `JWT_SECRET`
   - `CLIENT_ORIGIN` — למלא אחרי שלב 3 (כתובת ה-Vercel).
4. לחץ **Apply**. בסוף תקבל כתובת כמו `https://matbach-hachesed-server.onrender.com`.

### 3. העלאת הפרונט ל-Vercel
1. היכנס ל-[vercel.com](https://vercel.com) והתחבר עם GitHub.
2. **Add New → Project** ובחר את ה-repo.
3. הגדרות:
   - **Root Directory**: `client`
   - Framework: Vite (מזוהה אוטומטית)
4. **Environment Variables**: הוסף
   - `VITE_API_URL` = כתובת השרת מ-Render (בלי `/` בסוף).
5. **Deploy**. בסוף תקבל כתובת כמו `https://matbach-hachesed.vercel.app`.

### 4. סגירת המעגל (CORS)
חזור ל-Render → Environment → עדכן `CLIENT_ORIGIN` לכתובת ה-Vercel, ושמור (השרת יופעל מחדש).

## הערות
- **השרת ב-Render (חינם) נרדם** אחרי 15 דק' חוסר פעילות. הבקשה הראשונה תיקח ~30–50 שנ' ואז מהיר. מתאים להדגמה.
- **Supabase (חינם)** משהה פרויקט אחרי ~שבוע ללא פעילות — כניסה ל-Dashboard מעירה אותו.
- כניסה לניהול (דמו): `manager@demo.local` / `Demo1234!`. כניסת לקוח (דמו): `050-123-4567`.
- לעדכון גרסה: `git push` → Render ו-Vercel בונים מחדש אוטומטית.
