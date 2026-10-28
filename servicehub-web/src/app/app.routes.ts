import { Routes } from '@angular/router';
import { authGuard, guestGuard, homeGuard, roleGuard } from './core/guards';
import { LoginComponent } from './pages/login.component';
import { RegisterComponent } from './pages/register.component';
import { ShellComponent } from './layout/shell.component';
import { ProvidersComponent } from './pages/providers.component';
import { BookingsComponent } from './pages/bookings.component';
import { AvailabilityComponent } from './pages/availability.component';
import { ProfileComponent } from './pages/profile.component';
import { AccountComponent } from './pages/account.component';
import { AdminOverviewComponent } from './pages/admin-overview.component';
import { AdminUsersComponent } from './pages/admin-users.component';
import { AdminCategoriesComponent } from './pages/admin-categories.component';
import { AuditLogComponent } from './pages/audit-log.component';

export const routes: Routes = [
  { path: 'login', component: LoginComponent, canActivate: [guestGuard] },
  { path: 'register', component: RegisterComponent, canActivate: [guestGuard] },
  {
    path: '', component: ShellComponent, canActivate: [authGuard],
    children: [
      { path: '', pathMatch: 'full', canActivate: [homeGuard], children: [] },
      // customer
      { path: 'providers', component: ProvidersComponent, canActivate: [roleGuard('customer')] },
      { path: 'my-bookings', component: BookingsComponent, canActivate: [roleGuard('customer')] },
      // provider
      { path: 'requests', component: BookingsComponent, canActivate: [roleGuard('provider')] },
      { path: 'availability', component: AvailabilityComponent, canActivate: [roleGuard('provider')] },
      { path: 'profile', component: ProfileComponent, canActivate: [roleGuard('provider')] },
      // admin
      { path: 'overview', component: AdminOverviewComponent, canActivate: [roleGuard('admin')] },
      { path: 'users', component: AdminUsersComponent, canActivate: [roleGuard('admin')] },
      { path: 'categories', component: AdminCategoriesComponent, canActivate: [roleGuard('admin')] },
      { path: 'all-bookings', component: BookingsComponent, canActivate: [roleGuard('admin')] },
      { path: 'audit-log', component: AuditLogComponent, canActivate: [roleGuard('admin')] },
      // everyone
      { path: 'account', component: AccountComponent }
    ]
  },
  { path: '**', redirectTo: '' }
];
