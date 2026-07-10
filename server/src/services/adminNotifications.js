import { supabase } from '../lib/supabase.js';

export async function createAdminNotification(payload) {
  const { error } = await supabase.from('admin_notifications').insert(payload);
  if (error) {
    console.warn('Failed to create admin notification:', error.message);
  }
}
