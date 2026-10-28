import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AdminUser, AuditEntry, Booking, Category, Provider, ProviderMe, Slot, Stats, User } from './models';

/** Turns any error into a short message for the user. */
export function errMsg(e: unknown): string {
  if (e instanceof HttpErrorResponse) {
    const b = e.error as { error?: string; fields?: { field: string; message: string }[] } | null;
    if (b && b.error) {
      const f = b.fields ? b.fields.map(x => x.field + ': ' + x.message).join('; ') : '';
      return f ? b.error + ' (' + f + ')' : b.error;
    }
    if (e.status === 0) return 'Cannot reach the server. Is the backend running?';
  }
  return 'Something went wrong';
}

/** Every call to the secure Express API lives here. */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);
  private get<T>(url: string) { return firstValueFrom(this.http.get<T>('/api' + url)); }
  private send<T>(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, body?: unknown) {
    return firstValueFrom(this.http.request<T>(method, '/api' + url, { body }));
  }

  // auth
  me() { return this.get<{ user: User }>('/auth/me'); }
  login(email: string, password: string) { return this.send<{ user: User }>('POST', '/auth/login', { email, password }); }
  logout() { return this.send<{ ok: boolean }>('POST', '/auth/logout'); }
  register(body: unknown) { return this.send<{ message: string }>('POST', '/auth/register', body); }
  changePassword(current: string, next: string) { return this.send<{ ok: boolean }>('POST', '/auth/password', { current, next }); }

  // categories and providers
  categories() { return this.get<Category[]>('/categories'); }
  providers(categoryId?: number) { return this.get<Provider[]>('/providers' + (categoryId ? '?categoryId=' + categoryId : '')); }
  providerMe() { return this.get<ProviderMe>('/providers/me'); }
  saveProfile(body: { description: string; rate: string; categoryId: number }) { return this.send<{ ok: boolean }>('PUT', '/providers/me/profile', body); }
  saveAvailability(slots: Slot[]) { return this.send<{ ok: boolean }>('PUT', '/providers/me/availability', { slots }); }

  // bookings
  bookings() { return this.get<Booking[]>('/bookings'); }
  createBooking(body: { providerId: number; date: string; slot: number; note: string }) { return this.send<{ id: number }>('POST', '/bookings', body); }
  setStatus(id: number, status: string) { return this.send<{ ok: boolean }>('PATCH', '/bookings/' + id + '/status', { status }); }
  review(id: number, rating: number, text: string) { return this.send<{ ok: boolean }>('POST', '/bookings/' + id + '/review', { rating, text }); }

  // admin
  users() { return this.get<AdminUser[]>('/admin/users'); }
  setUserStatus(id: number, status: 'Active' | 'Suspended') { return this.send<{ ok: boolean }>('PATCH', '/admin/users/' + id + '/status', { status }); }
  addCategory(name: string) { return this.send<{ id: number }>('POST', '/admin/categories', { name }); }
  deleteCategory(id: number) { return this.send<{ ok: boolean }>('DELETE', '/admin/categories/' + id); }
  stats() { return this.get<Stats>('/admin/stats'); }
  auditLogs() { return this.get<AuditEntry[]>('/admin/audit-logs?limit=200'); }
  backup() { return this.send<{ ok: boolean; file: string }>('POST', '/admin/backup'); }
}
