export type Role = 'customer' | 'provider' | 'admin';
export interface User { id: number; role: Role; name: string; email: string; status: string; }
export interface Category { id: number; name: string; }
export interface Slot { weekday: number; slot: number; }
export interface Provider {
  id: number; name: string; address: string; description: string; rate: string;
  category: string; rating: number | null; availability: Slot[];
}
export interface ProviderMe { name: string; status: string; description: string; rate: string; categoryId: number; availability: Slot[]; }
export interface Booking {
  id: number; date: string; slot: number; note: string; status: string; created_at: string;
  customer_name: string; customer_contact?: string; customer_address?: string;
  provider_name: string; provider_contact?: string; category: string; reviewed: boolean;
}
export interface AdminUser { id: number; role: Role; name: string; email: string; contact: string; address: string; status: string; created_at: string; }
export interface AuditEntry { id: number; user_id: number | null; action: string; entity: string | null; entity_id: number | null; ip: string | null; detail: string | null; created_at: string; }
export interface Stats { customers: number; providers: number; bookingsByStatus: { status: string; n: number }[]; }

export const SLOTS = ['Morning (8–12)', 'Afternoon (1–5)', 'Evening (5–8)'];
export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
