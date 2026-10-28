import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { Role } from './models';

/** Only logged-in users. */
export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService), router = inject(Router);
  return (await auth.ensureLoaded()) ? true : router.parseUrl('/login');
};

/** Login and register pages: logged-in users are sent to their own home page. */
export const guestGuard: CanActivateFn = async () => {
  const auth = inject(AuthService), router = inject(Router);
  const u = await auth.ensureLoaded();
  return u ? router.parseUrl(auth.home(u.role)) : true;
};

/** The empty address "/" sends each role to its own start page. */
export const homeGuard: CanActivateFn = async () => {
  const auth = inject(AuthService), router = inject(Router);
  const u = await auth.ensureLoaded();
  return router.parseUrl(u ? auth.home(u.role) : '/login');
};

/** Role-based access control in the browser. The server enforces it again on every request. */
export const roleGuard = (...roles: Role[]): CanActivateFn => async () => {
  const auth = inject(AuthService), router = inject(Router);
  const u = await auth.ensureLoaded();
  if (!u) return router.parseUrl('/login');
  return roles.includes(u.role) ? true : router.parseUrl(auth.home(u.role));
};
