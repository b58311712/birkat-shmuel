// לוגיקת תצוגה, מיון וחיפוש של לקוחות - משותפת לכל שדות בחירת הלקוח.

// שם התצוגה בבורר: שם המשפחה תחילה, כדי שרשימה הממוינת לפי שם משפחה תיקרא
// כמו ספר טלפונים. לרשומה בלי שם משפחה (ארגון/גורם משלם) - השם המלא כמות שהוא.
export function customerDisplayName(customer) {
  if (!customer) return '';
  const last = String(customer.last_name || '').trim();
  const first = String(customer.first_name || '').trim();
  if (!last) return String(customer.full_name || first || '').trim();
  return first ? `${last} ${first}` : last;
}

function sortKey(customer) {
  const last = String(customer.last_name || '').trim();
  const first = String(customer.first_name || '').trim();
  // רשומה בלי שם משפחה ממוינת לפי השם המלא, באותה רשימה
  return `${last || String(customer.full_name || first || '').trim()} ${first}`.trim();
}

// מיון א"ב עברי לפי שם משפחה ואז שם פרטי.
// priority (אופציונלי) מקבץ קודם - למשל ארגונים לפני אנשים פרטיים.
export function sortCustomersByLastName(customers, priority) {
  return [...(customers || [])].sort((a, b) => {
    if (priority) {
      const diff = priority(a) - priority(b);
      if (diff) return diff;
    }
    return sortKey(a).localeCompare(sortKey(b), 'he', { numeric: true, sensitivity: 'base' });
  });
}

function normalize(text) {
  return String(text ?? '').toLocaleLowerCase('he-IL').trim();
}

export function searchTerms(query) {
  return normalize(query).split(/\s+/).filter(Boolean);
}

// כל מילה בחיפוש חייבת להימצא באחד משדות הלקוח - כך "כהן משה" מוצא גם כשהשם
// מאוחסן בסדר ההפוך, וגם חיפוש לפי טלפון או מייל חלקי עובד.
export function customerMatchesTerms(customer, terms) {
  if (terms.length === 0) return true;
  const haystack = [
    customer.last_name, customer.first_name, customer.full_name,
    customerDisplayName(customer), customer.phone, customer.email,
  ].filter(Boolean).map(normalize).join(' ');
  return terms.every((term) => haystack.includes(term));
}

export function filterCustomers(customers, query) {
  const terms = searchTerms(query);
  return (customers || []).filter((customer) => customerMatchesTerms(customer, terms));
}
