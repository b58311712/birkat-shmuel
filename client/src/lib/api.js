// שכבת קריאות לשרת.
// בפיתוח: כתובת ריקה → קריאה ל-/api עוברת דרך פרוקסי של Vite ל-Node המקומי.
// בפרודקשן: VITE_API_URL מצביע על כתובת השרת (למשל https://xxx.onrender.com).
const API_BASE = import.meta.env.VITE_API_URL || '';

const ADMIN_TOKEN_KEY = 'matbach_admin_token';
const ADMIN_AUTH_NOTICE_KEY = 'matbach_admin_auth_notice';

function setAdminAuthNotice(message) {
  sessionStorage.setItem(ADMIN_AUTH_NOTICE_KEY, message);
}

function isExpiredToken(token) {
  try {
    const rawPayload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = rawPayload.padEnd(Math.ceil(rawPayload.length / 4) * 4, '=');
    const decoded = JSON.parse(atob(payload));
    return !decoded.exp || decoded.exp * 1000 <= Date.now();
  } catch {
    return true;
  }
}

// ניהול טוקן מנהל בדפדפן
export const adminAuth = {
  get: () => {
    const token = localStorage.getItem(ADMIN_TOKEN_KEY);
    if (token && isExpiredToken(token)) {
      localStorage.removeItem(ADMIN_TOKEN_KEY);
      setAdminAuthNotice('פג תוקף ההתחברות. יש להתחבר מחדש; שינויים שלא נשמרו יישארו כטיוטה.');
      return null;
    }
    return token;
  },
  set: (t) => localStorage.setItem(ADMIN_TOKEN_KEY, t),
  clear: () => localStorage.removeItem(ADMIN_TOKEN_KEY),
};

export function consumeAdminAuthNotice() {
  const notice = sessionStorage.getItem(ADMIN_AUTH_NOTICE_KEY) || '';
  sessionStorage.removeItem(ADMIN_AUTH_NOTICE_KEY);
  return notice;
}

// נזרק כשטוקן המנהל חסר/פג - מאפשר לפרונט להפנות חזרה לכניסה.
export class AdminAuthError extends Error {
  constructor(message) { super(message); this.name = 'AdminAuthError'; }
}

async function request(path, options = {}) {
  const admin = path.startsWith('/admin');
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (admin) {
    const token = adminAuth.get();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}/api${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    // טוקן מנהל פג/לא תקין - מנקים ומאותתים לפרונט. 403 הוא כשל הרשאה, לא כשל התחברות.
    if (admin && res.status === 401) {
      adminAuth.clear();
      setAdminAuthNotice('פג תוקף ההתחברות. יש להתחבר מחדש; שינויים בנוסחי המייל נשמרו כטיוטה.');
      throw new AdminAuthError(data.error || 'נדרשת התחברות מנהל מחדש.');
    }
    throw new Error(data.error || 'אירעה שגיאה. נא לנסות שוב.');
  }
  return data;
}

export const api = {
  // אימות לקוח
  login: (phone) => request('/auth/login', { method: 'POST', body: JSON.stringify({ phone }) }),
  register: (payload) => request('/auth/register', { method: 'POST', body: JSON.stringify(payload) }),

  // אימות מנהל (סעיף 5)
  adminLogin: (email, password) =>
    request('/auth/admin-login', { method: 'POST', body: JSON.stringify({ email, password }) }),

  // הגדרות ציבוריות (שיעור מע"מ וכו')
  publicSettings: () => request('/settings/public'),

  // קטלוג ושבתות
  catalog: () => request('/catalog'),
  openShabbatot: () => request('/shabbatot/open'),
  allShabbatot: () => request('/shabbatot'),

  // הזמנות
  createOrder: (payload) => request('/orders', { method: 'POST', body: JSON.stringify(payload) }),
  customerOrders: (id) => request(`/orders/customer/${id}`),
  order: (id) => request(`/orders/${id}`),

  // ניהול (דורש טוקן מנהל)
  adminOrders: (q = '') => request(`/admin/orders${q}`),
  adminOrder: (id) => request(`/admin/orders/${id}`),
  updateOrder: (id, payload) => request(`/admin/orders/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  updateOrderCustomer: (id, payload) => request(`/admin/orders/${id}/customer`, { method: 'PATCH', body: JSON.stringify(payload) }),
  adminDashboard: () => request('/admin/dashboard'),
  financeSummary: () => request('/admin/finance/summary'),

  // קופה קטנה
  pettyCash: () => request('/admin/petty-cash'),
  addPettyCashTx: (payload) => request('/admin/petty-cash', { method: 'POST', body: JSON.stringify(payload) }),
  deletePettyCashTx: (id) => request(`/admin/petty-cash/${id}`, { method: 'DELETE' }),

  // הוצאות קבועות חודשיות (תבניות תקורה חוזרת + הפקה חודשית)
  recurringExpenses: () => request('/admin/recurring-expenses'),
  createRecurringExpense: (payload) => request('/admin/recurring-expenses', { method: 'POST', body: JSON.stringify(payload) }),
  updateRecurringExpense: (id, payload) => request(`/admin/recurring-expenses/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteRecurringExpense: (id) => request(`/admin/recurring-expenses/${id}`, { method: 'DELETE' }),
  recurringGenerationStatus: (month) => request(`/admin/recurring-expenses/generation-status?month=${month}`),
  generateRecurringExpenses: (month) => request('/admin/recurring-expenses/generate', { method: 'POST', body: JSON.stringify({ month }) }),
  generatedRecurringExpenses: (month) => request(`/admin/recurring-expenses/generated${month ? `?month=${month}` : ''}`),
  approveOrder: (id) => request(`/admin/orders/${id}/approve`, { method: 'POST' }),
  cancelOrder: (id, reason) => request(`/admin/orders/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }),
  updatePayment: (id, payload) => request(`/admin/orders/${id}/payment`, { method: 'POST', body: JSON.stringify(payload) }),
  adminNotifications: () => request('/admin/notifications'),
  markNotificationRead: (id) => request(`/admin/notifications/${id}/read`, { method: 'POST' }),

  // מיילים (סעיף 18)
  emailTemplates: () => request('/admin/email/templates'),
  updateEmailTemplate: (code, payload) => request(`/admin/email/templates/${code}`, { method: 'PUT', body: JSON.stringify(payload) }),
  emailLog: () => request('/admin/email/log'),
  sendPaymentReminders: (overdueOnly) => request('/admin/orders/payment-reminders', { method: 'POST', body: JSON.stringify({ overdue_only: overdueOnly }) }),

  // גבייה מלקוחות (סעיף 17)
  orderPayments: (id) => request(`/admin/payments/orders/${id}/payments`),
  addOrderPayment: (id, payload) => request(`/admin/payments/orders/${id}/payments`, { method: 'POST', body: JSON.stringify(payload) }),
  removeOrderPayment: (id, pid) => request(`/admin/payments/orders/${id}/payments/${pid}`, { method: 'DELETE' }),
  setPaymentOverride: (id, enable) => request(`/admin/payments/orders/${id}/payment-override`, { method: 'POST', body: JSON.stringify({ enable }) }),

  // החזרים כספיים (סעיף 19)
  orderRefunds: (id) => request(`/admin/payments/orders/${id}/refunds`),
  createRefund: (id, payload) => request(`/admin/payments/orders/${id}/refunds`, { method: 'POST', body: JSON.stringify(payload) }),
  updateRefund: (rid, payload) => request(`/admin/payments/refunds/${rid}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  executeRefund: (rid, payload) => request(`/admin/payments/refunds/${rid}/execute`, { method: 'POST', body: JSON.stringify(payload) }),
  cancelRefund: (rid, reason) => request(`/admin/payments/refunds/${rid}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }),
  addOrderDiscount: (id, payload) => request(`/admin/orders/${id}/discounts`, { method: 'POST', body: JSON.stringify(payload) }),
  removeOrderDiscount: (id, discountId) => request(`/admin/orders/${id}/discounts/${discountId}`, { method: 'DELETE' }),
  addOrderManualCharge: (id, payload) => request(`/admin/orders/${id}/manual-charges`, { method: 'POST', body: JSON.stringify(payload) }),
  removeOrderManualCharge: (id, chargeId) => request(`/admin/orders/${id}/manual-charges/${chargeId}`, { method: 'DELETE' }),
  deleteOrder: (id) => request(`/admin/orders/${id}`, { method: 'DELETE' }),
  registrations: () => request('/admin/registrations'),
  approveRegistration: (id) => request(`/admin/registrations/${id}/approve`, { method: 'POST' }),
  rejectRegistration: (id, reason) =>
    request(`/admin/registrations/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }),
  deleteRegistration: (id) => request(`/admin/registrations/${id}`, { method: 'DELETE' }),

  // ניהול לקוחות (סעיף 6)
  adminCustomers: (q = '') => request(`/admin/customers${q}`),
  adminCustomer: (id) => request(`/admin/customers/${id}`),
  createCustomer: (payload) => request('/admin/customers', { method: 'POST', body: JSON.stringify(payload) }),
  importCustomers: (rows) => request('/admin/customers/import', { method: 'POST', body: JSON.stringify({ rows }) }),
  updateCustomer: (id, payload) => request(`/admin/customers/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteCustomer: (id) => request(`/admin/customers/${id}`, { method: 'DELETE' }),

  // ניהול משתמשי מערכת (סעיף 5, 34.27)
  adminUsers: (q = '') => request(`/admin/users${q}`),
  createAdminUser: (payload) => request('/admin/users', { method: 'POST', body: JSON.stringify(payload) }),
  updateAdminUser: (id, payload) => request(`/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  resetAdminUserPassword: (id, password) =>
    request(`/admin/users/${id}/password`, { method: 'POST', body: JSON.stringify({ password }) }),
  deleteAdminUser: (id) => request(`/admin/users/${id}`, { method: 'DELETE' }),

  // ניהול מאכלים וקטגוריות (סעיף 13)
  catalogMealSlots: (q = '') => request(`/admin/catalog/meal-slots${q}`),
  catalogCategories: (q = '') => request(`/admin/catalog/categories${q}`),
  createCatalogCategory: (payload) => request('/admin/catalog/categories', { method: 'POST', body: JSON.stringify(payload) }),
  updateCatalogCategory: (id, payload) => request(`/admin/catalog/categories/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteCatalogCategory: (id) => request(`/admin/catalog/categories/${id}`, { method: 'DELETE' }),
  catalogMeals: (q = '') => request(`/admin/catalog/meals${q}`),
  createCatalogMeal: (payload) => request('/admin/catalog/meals', { method: 'POST', body: JSON.stringify(payload) }),
  updateCatalogMeal: (id, payload) => request(`/admin/catalog/meals/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteCatalogMeal: (id) => request(`/admin/catalog/meals/${id}`, { method: 'DELETE' }),
  deleteCatalogMealSlot: (id) => request(`/admin/catalog/meal-slots/${id}`, { method: 'DELETE' }),
  catalogMealRecipe: (id) => request(`/admin/catalog/meals/${id}/recipe`),
  setCatalogMealRecipe: (id, payload) => request(`/admin/catalog/meals/${id}/recipe`, { method: 'PUT', body: JSON.stringify(payload) }),
  catalogMealPacking: (id) => request(`/admin/catalog/meals/${id}/packing`),
  setCatalogMealPacking: (id, payload) => request(`/admin/catalog/meals/${id}/packing`, { method: 'PUT', body: JSON.stringify(payload) }),
  catalogExtras: (q = '') => request(`/admin/catalog/extras${q}`),
  createCatalogExtra: (payload) => request('/admin/catalog/extras', { method: 'POST', body: JSON.stringify(payload) }),
  updateCatalogExtra: (id, payload) => request(`/admin/catalog/extras/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteCatalogExtra: (id) => request(`/admin/catalog/extras/${id}`, { method: 'DELETE' }),

  // מסלולי מחיר / מחיר בסיס לפי מספר סעודות (סעיף 15)
  catalogPriceTracks: (q = '') => request(`/admin/catalog/price-tracks${q}`),
  createCatalogPriceTrack: (payload) => request('/admin/catalog/price-tracks', { method: 'POST', body: JSON.stringify(payload) }),
  updateCatalogPriceTrack: (id, payload) => request(`/admin/catalog/price-tracks/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteCatalogPriceTrack: (id) => request(`/admin/catalog/price-tracks/${id}`, { method: 'DELETE' }),

  // תיק שבת (סעיף 9)
  shabbatFiles: () => request('/admin/shabbat-files'),
  createShabbat: (payload) => request('/admin/shabbat-files', { method: 'POST', body: JSON.stringify(payload) }),
  shabbatSummary: (id) => request(`/admin/shabbat-files/${id}/summary`),
  shabbatKitchen: (id) => request(`/admin/shabbat-files/${id}/kitchen`),
  shabbatInventory: (id) => request(`/admin/shabbat-files/${id}/inventory`),
  shabbatPacking: (id) => request(`/admin/shabbat-files/${id}/packing`),
  shabbatTransport: (id) => request(`/admin/shabbat-files/${id}/transport`),
  shabbatVolunteers: (id) => request(`/admin/shabbat-files/${id}/volunteers`),
  shabbatWorkFile: (id) => request(`/admin/shabbat-files/${id}/workfile`),
  shabbatVolunteerAutoAssign: (id) => request(`/admin/shabbat-files/${id}/volunteers/auto-assign`, { method: 'POST' }),
  shabbatVolunteerAssign: (id, payload) => request(`/admin/shabbat-files/${id}/volunteers/assign`, { method: 'POST', body: JSON.stringify(payload) }),
  shabbatVolunteerReset: (id, taskId) => request(`/admin/shabbat-files/${id}/volunteers/tasks/${taskId}/reset`, { method: 'POST' }),
  shabbatVolunteerMealAssign: (id, mealId, payload) => request(`/admin/shabbat-files/${id}/volunteers/meals/${mealId}/assign`, { method: 'POST', body: JSON.stringify(payload) }),
  shabbatVolunteerMealReset: (id, mealId) => request(`/admin/shabbat-files/${id}/volunteers/meals/${mealId}/reset`, { method: 'POST' }),
  shabbatStatus: (id, status) => request(`/admin/shabbat-files/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  shabbatNotes: (id, notes) => request(`/admin/shabbat-files/${id}/notes`, { method: 'PATCH', body: JSON.stringify({ notes }) }),
  deleteShabbat: (id) => request(`/admin/shabbat-files/${id}`, { method: 'DELETE' }),

  // ניהול מתנדבים ומשימות קבועות (סעיף 24)
  volunteers: (q = '') => request(`/admin/volunteers${q}`),
  createVolunteer: (payload) => request('/admin/volunteers', { method: 'POST', body: JSON.stringify(payload) }),
  updateVolunteer: (id, payload) => request(`/admin/volunteers/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteVolunteer: (id) => request(`/admin/volunteers/${id}`, { method: 'DELETE' }),
  volunteerTasks: (q = '') => request(`/admin/volunteers/tasks${q}`),
  createVolunteerTask: (payload) => request('/admin/volunteers/tasks', { method: 'POST', body: JSON.stringify(payload) }),
  updateVolunteerTask: (id, payload) => request(`/admin/volunteers/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteVolunteerTask: (id) => request(`/admin/volunteers/tasks/${id}`, { method: 'DELETE' }),
  volunteerAreas: () => request('/admin/volunteers/areas'),
  createVolunteerArea: (payload) => request('/admin/volunteers/areas', { method: 'POST', body: JSON.stringify(payload) }),
  updateVolunteerArea: (id, payload) => request(`/admin/volunteers/areas/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteVolunteerArea: (id) => request(`/admin/volunteers/areas/${id}`, { method: 'DELETE' }),

  // ניהול מלאי (סעיף 25)
  invItems: (q = '') => request(`/admin/inventory/items${q}`),
  invItem: (id) => request(`/admin/inventory/items/${id}`),
  createInvItem: (payload) => request('/admin/inventory/items', { method: 'POST', body: JSON.stringify(payload) }),
  updateInvItem: (id, payload) => request(`/admin/inventory/items/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteInvItem: (id) => request(`/admin/inventory/items/${id}`, { method: 'DELETE' }),
  adjustInvItem: (id, payload) => request(`/admin/inventory/items/${id}/adjust`, { method: 'POST', body: JSON.stringify(payload) }),
  invCategories: (q = '') => request(`/admin/inventory/categories${q}`),
  createInvCategory: (payload) => request('/admin/inventory/categories', { method: 'POST', body: JSON.stringify(payload) }),
  updateInvCategory: (id, payload) => request(`/admin/inventory/categories/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteInvCategory: (id) => request(`/admin/inventory/categories/${id}`, { method: 'DELETE' }),
  invSuppliers: (q = '') => request(`/admin/inventory/suppliers${q}`),
  createInvSupplier: (payload) => request('/admin/inventory/suppliers', { method: 'POST', body: JSON.stringify(payload) }),
  updateInvSupplier: (id, payload) => request(`/admin/inventory/suppliers/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteInvSupplier: (id) => request(`/admin/inventory/suppliers/${id}`, { method: 'DELETE' }),
  invMovements: (q = '') => request(`/admin/inventory/movements${q}`),
  invDeductionPreview: (shabbatId) => request(`/admin/inventory/shabbat/${shabbatId}/deduction-preview`),
  invDeduct: (shabbatId, lines) => request(`/admin/inventory/shabbat/${shabbatId}/deduct`, { method: 'POST', body: JSON.stringify({ lines }) }),
  // ניכוי מלאי אוטומטי מלא לפי מתכונים (המרת יחידות + עסקה אטומית)
  invDeductAuto: (shabbatId) => request(`/admin/inventory/shabbat/${shabbatId}/deduct-auto`, { method: 'POST' }),

  // יחידות מידה גלובליות (סעיף 25)
  invUnits: (q = '') => request(`/admin/inventory/units${q}`),
  createInvUnit: (payload) => request('/admin/inventory/units', { method: 'POST', body: JSON.stringify(payload) }),
  updateInvUnit: (id, payload) => request(`/admin/inventory/units/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteInvUnit: (id) => request(`/admin/inventory/units/${id}`, { method: 'DELETE' }),
  // [כלי מיזוג זמני] מיזוג יחידה (:id = מקור) ליחידת יעד
  mergeInvUnit: (id, targetId) => request(`/admin/inventory/units/${id}/merge`, { method: 'POST', body: JSON.stringify({ target_id: targetId }) }),

  // המרות יחידה פר-פריט (סעיף 25.4)
  invItemConversions: (itemId) => request(`/admin/inventory/items/${itemId}/conversions`),
  createInvConversion: (itemId, payload) => request(`/admin/inventory/items/${itemId}/conversions`, { method: 'POST', body: JSON.stringify(payload) }),
  updateInvConversion: (id, payload) => request(`/admin/inventory/conversions/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteInvConversion: (id) => request(`/admin/inventory/conversions/${id}`, { method: 'DELETE' }),

  // ניהול ספקים (סעיף 27.1)
  suppliers: (q = '') => request(`/admin/suppliers${q}`),
  supplier: (id) => request(`/admin/suppliers/${id}`),
  createSupplier: (payload) => request('/admin/suppliers', { method: 'POST', body: JSON.stringify(payload) }),
  updateSupplier: (id, payload) => request(`/admin/suppliers/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteSupplier: (id) => request(`/admin/suppliers/${id}`, { method: 'DELETE' }),
  setSupplierItems: (id, items) => request(`/admin/suppliers/${id}/items`, { method: 'PUT', body: JSON.stringify({ items }) }),

  // הזמנות רכש (סעיף 27.2-27.3)
  purchaseOrders: (q = '') => request(`/admin/suppliers/purchase-orders/list${q}`),
  purchaseOrder: (id) => request(`/admin/suppliers/purchase-orders/${id}`),
  createPurchaseOrder: (payload) => request('/admin/suppliers/purchase-orders', { method: 'POST', body: JSON.stringify(payload) }),
  updatePurchaseOrder: (id, payload) => request(`/admin/suppliers/purchase-orders/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deletePurchaseOrder: (id) => request(`/admin/suppliers/purchase-orders/${id}`, { method: 'DELETE' }),
  setPurchaseOrderStatus: (id, status) => request(`/admin/suppliers/purchase-orders/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
  receivePurchaseOrder: (id, lines) => request(`/admin/suppliers/purchase-orders/${id}/receive`, { method: 'POST', body: JSON.stringify({ lines }) }),
  setPurchaseOrderPayment: (id, payload) => request(`/admin/suppliers/purchase-orders/${id}/payment`, { method: 'PUT', body: JSON.stringify(payload) }),
};
