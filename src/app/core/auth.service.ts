import { Injectable, inject, signal } from '@angular/core';
import { ApiService } from './api.service';
import { Role, User } from './models';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private api = inject(ApiService);
  readonly user = signal<User | null>(null);
  private loaded: Promise<User | null> | null = null;

  /** Asks the server once who is logged in (the cookie is httpOnly, so JavaScript cannot read it). */
  ensureLoaded(): Promise<User | null> {
    if (!this.loaded) {
      this.loaded = this.api.me().then(r => { this.user.set(r.user); return r.user; }).catch(() => null);
    }
    return this.loaded;
  }
  async login(email: string, password: string): Promise<User> {
    const r = await this.api.login(email, password);
    this.user.set(r.user);
    this.loaded = Promise.resolve(r.user);
    return r.user;
  }
  async logout() {
    try { await this.api.logout(); } catch { /* already logged out */ }
    this.reset();
  }
  reset() { this.user.set(null); this.loaded = Promise.resolve(null); }

  home(role: Role): string {
    return role === 'customer' ? '/providers' : role === 'provider' ? '/requests' : '/overview';
  }
}
