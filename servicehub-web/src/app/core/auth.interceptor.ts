import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from './auth.service';

/**
 * 1) Adds the X-Requested-With header the server requires on every API call (CSRF defence).
 * 2) If the session expires (401), sends the user back to the login page.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const request = req.url.startsWith('/api') ? req.clone({ setHeaders: { 'X-Requested-With': 'ServiceHub' } }) : req;
  return next(request).pipe(
    catchError((e: HttpErrorResponse) => {
      if (e.status === 401 && !req.url.startsWith('/api/auth/')) {
        auth.reset();
        router.navigateByUrl('/login');
      }
      return throwError(() => e);
    })
  );
};
