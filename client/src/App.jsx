import { useState } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { Header } from './components/Layout.jsx';
import AdminDashboardShell from './components/AdminDashboardShell.jsx';
import { adminAuth } from './lib/api.js';
import Login from './pages/Login.jsx';
import AdminLogin from './pages/AdminLogin.jsx';
import NewOrder from './pages/NewOrder.jsx';
import MyOrders from './pages/MyOrders.jsx';
import OrderView from './pages/OrderView.jsx';
import AdminDashboard from './pages/AdminDashboard.jsx';
import AdminCustomers from './pages/AdminCustomers.jsx';
import AdminRegistrations from './pages/AdminRegistrations.jsx';
import AdminOrders from './pages/AdminOrders.jsx';
import AdminOrderView from './pages/AdminOrderView.jsx';
import AdminOrderEdit from './pages/AdminOrderEdit.jsx';
import ShabbatFiles from './pages/ShabbatFiles.jsx';
import ShabbatFile from './pages/ShabbatFile.jsx';
import AdminVolunteers from './pages/AdminVolunteers.jsx';
import AdminInventory from './pages/AdminInventory.jsx';
import AdminSuppliers from './pages/AdminSuppliers.jsx';
import AdminPurchaseOrders from './pages/AdminPurchaseOrders.jsx';
import AdminPurchaseOrderView from './pages/AdminPurchaseOrderView.jsx';
import AdminUsers from './pages/AdminUsers.jsx';
import AdminCatalog from './pages/AdminCatalog.jsx';
import AdminPrintForm from './pages/AdminPrintForm.jsx';
import AdminFinance from './pages/AdminFinance.jsx';
import AdminPettyCash from './pages/AdminPettyCash.jsx';
import AdminRecurringExpenses from './pages/AdminRecurringExpenses.jsx';
import AdminEmail from './pages/AdminEmail.jsx';

const STORAGE_KEY = 'matbach_customer';
const ADMIN_USER_KEY = 'matbach_admin_user';

export default function App() {
  const [customer, setCustomer] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { return null; }
  });
  // מנהל מחובר רק אם יש גם טוקן וגם פרטי משתמש שמורים
  const [admin, setAdmin] = useState(() => {
    try {
      return adminAuth.get() ? JSON.parse(localStorage.getItem(ADMIN_USER_KEY)) : null;
    } catch { return null; }
  });
  const nav = useNavigate();

  function login(c) {
    setCustomer(c);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
    nav('/new-order');
  }
  function logout() {
    setCustomer(null);
    localStorage.removeItem(STORAGE_KEY);
    nav('/');
  }

  function adminLogin({ token, user }) {
    adminAuth.set(token);
    localStorage.setItem(ADMIN_USER_KEY, JSON.stringify(user));
    setAdmin(user);
    nav('/admin');
  }
  function adminLogout() {
    adminAuth.clear();
    localStorage.removeItem(ADMIN_USER_KEY);
    setAdmin(null);
    nav('/admin');
  }

  return (
    <Routes>
      {/* אזור ניהול — מאחורי כניסת מנהל (סעיף 5) */}
      {!admin ? (
        <Route path="/admin/*" element={<AdminLogin onLogin={adminLogin} />} />
      ) : (
        <>
          <Route path="/admin" element={
            <AdminDashboardShell admin={admin} onAdminLogout={adminLogout}>
              <AdminDashboard onAuthError={adminLogout} />
            </AdminDashboardShell>
          } />
          <Route path="/admin/orders" element={
            <AdminDashboardShell admin={admin} onAdminLogout={adminLogout}>
              <AdminOrders onAuthError={adminLogout} currentAdmin={admin} />
            </AdminDashboardShell>
          } />
          <Route path="/admin/customers" element={
            <AdminShell admin={admin} onAdminLogout={adminLogout}>
              <AdminCustomers onAuthError={adminLogout} currentAdmin={admin} />
            </AdminShell>
          } />
          <Route path="/admin/registrations" element={
            <AdminShell admin={admin} onAdminLogout={adminLogout}>
              <AdminRegistrations onAuthError={adminLogout} />
            </AdminShell>
          } />
          <Route path="/admin/orders/:id" element={
            <AdminShell admin={admin} onAdminLogout={adminLogout}>
              <AdminOrderView onAuthError={adminLogout} currentAdmin={admin} />
            </AdminShell>
          } />
          <Route path="/admin/orders/:id/edit" element={
            <AdminShell admin={admin} onAdminLogout={adminLogout}>
              <AdminOrderEdit onAuthError={adminLogout} />
            </AdminShell>
          } />
          <Route path="/admin/shabbat" element={
            <AdminShell admin={admin} onAdminLogout={adminLogout}>
              <ShabbatFiles onAuthError={adminLogout} currentAdmin={admin} />
            </AdminShell>
          } />
          <Route path="/admin/shabbat/:id" element={
            <AdminShell admin={admin} onAdminLogout={adminLogout}>
              <ShabbatFile onAuthError={adminLogout} />
            </AdminShell>
          } />
          <Route path="/admin/volunteers" element={
            <AdminShell admin={admin} onAdminLogout={adminLogout}>
              <AdminVolunteers onAuthError={adminLogout} currentAdmin={admin} />
            </AdminShell>
          } />
          <Route path="/admin/inventory" element={
            <AdminShell admin={admin} onAdminLogout={adminLogout}>
              <AdminInventory onAuthError={adminLogout} currentAdmin={admin} />
            </AdminShell>
          } />
          <Route path="/admin/catalog" element={
            <AdminShell admin={admin} onAdminLogout={adminLogout}>
              <AdminCatalog onAuthError={adminLogout} currentAdmin={admin} />
            </AdminShell>
          } />
          <Route path="/admin/print-form" element={
            <AdminShell admin={admin} onAdminLogout={adminLogout}>
              <AdminPrintForm onAuthError={adminLogout} />
            </AdminShell>
          } />
          <Route path="/admin/suppliers" element={
            <AdminShell admin={admin} onAdminLogout={adminLogout}>
              <AdminSuppliers onAuthError={adminLogout} currentAdmin={admin} />
            </AdminShell>
          } />
          <Route path="/admin/purchase-orders" element={
            <AdminShell admin={admin} onAdminLogout={adminLogout}>
              <AdminPurchaseOrders onAuthError={adminLogout} currentAdmin={admin} />
            </AdminShell>
          } />
          <Route path="/admin/purchase-orders/:id" element={
            <AdminShell admin={admin} onAdminLogout={adminLogout}>
              <AdminPurchaseOrderView onAuthError={adminLogout} currentAdmin={admin} />
            </AdminShell>
          } />
          <Route path="/admin/users" element={
            <AdminShell admin={admin} onAdminLogout={adminLogout}>
              <AdminUsers onAuthError={adminLogout} currentAdmin={admin} />
            </AdminShell>
          } />
          <Route path="/admin/finance" element={
            <AdminShell admin={admin} onAdminLogout={adminLogout}>
              <AdminFinance onAuthError={adminLogout} />
            </AdminShell>
          } />
          <Route path="/admin/petty-cash" element={
            <AdminShell admin={admin} onAdminLogout={adminLogout}>
              <AdminPettyCash onAuthError={adminLogout} />
            </AdminShell>
          } />
          <Route path="/admin/recurring-expenses" element={
            <AdminShell admin={admin} onAdminLogout={adminLogout}>
              <AdminRecurringExpenses onAuthError={adminLogout} />
            </AdminShell>
          } />
          <Route path="/admin/email" element={
            <AdminShell admin={admin} onAdminLogout={adminLogout}>
              <AdminEmail onAuthError={adminLogout} />
            </AdminShell>
          } />
          <Route path="/admin/*" element={<Navigate to="/admin" replace />} />
        </>
      )}

      {/* אזור לקוח */}
      {!customer ? (
        <Route path="*" element={<Login onLogin={login} />} />
      ) : (
        <>
          <Route path="/" element={<Navigate to="/new-order" replace />} />
          <Route path="/new-order" element={<Shell customer={customer} onLogout={logout}><NewOrder customer={customer} /></Shell>} />
          <Route path="/my-orders" element={<Shell customer={customer} onLogout={logout}><MyOrders customer={customer} /></Shell>} />
          <Route path="/order/:id" element={<Shell customer={customer} onLogout={logout}><OrderView /></Shell>} />
          <Route path="*" element={<Navigate to="/new-order" replace />} />
        </>
      )}
    </Routes>
  );
}

function Shell({ customer, onLogout, children }) {
  return (
    <div className="customer-ui min-h-screen">
      <Header customer={customer} onLogout={onLogout} />
      {children}
    </div>
  );
}

function AdminShell({ admin, onAdminLogout, children }) {
  return (
    <AdminDashboardShell admin={admin} onAdminLogout={onAdminLogout}>
      {children}
    </AdminDashboardShell>
  );
}
