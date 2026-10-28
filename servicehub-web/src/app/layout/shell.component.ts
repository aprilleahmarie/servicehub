import { Component, computed, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { Role } from '../core/models';

const NAV: Record<Role, { path: string; label: string }[]> = {
  customer: [{ path: 'providers', label: 'Find providers' }, { path: 'my-bookings', label: 'My bookings' }, { path: 'account', label: 'Account' }],
  provider: [{ path: 'requests', label: 'Requests' }, { path: 'availability', label: 'Availability' }, { path: 'profile', label: 'Profile' }, { path: 'account', label: 'Account' }],
  admin: [{ path: 'overview', label: 'Overview' }, { path: 'users', label: 'Users' }, { path: 'categories', label: 'Categories' }, { path: 'all-bookings', label: 'Bookings' }, { path: 'audit-log', label: 'Audit log' }, { path: 'account', label: 'Account' }]
};

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  template: `
    <header>
      <span class="brand">Service<i>Hub</i></span>
      <div class="who">
        <small>{{ auth.user()?.name }} · {{ auth.user()?.role }}</small>
        <button class="btn alt sm" (click)="logout()">Sign out</button>
      </div>
    </header>
    <main>
      <nav>
        @for (l of links(); track l.path) {
          <a [routerLink]="'/' + l.path" routerLinkActive="on">{{ l.label }}</a>
        }
      </nav>
      <router-outlet />
    </main>
  `
})
export class ShellComponent {
  auth = inject(AuthService);
  private router = inject(Router);
  links = computed(() => NAV[this.auth.user()?.role ?? 'customer']);

  async logout() {
    await this.auth.logout();
    await this.router.navigateByUrl('/login');
  }
}
