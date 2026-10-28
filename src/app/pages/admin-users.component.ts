import { Component, inject, OnInit, signal } from '@angular/core';
import { ApiService, errMsg } from '../core/api.service';
import { AdminUser } from '../core/models';
import { ToastService } from '../core/toast.service';

@Component({
  selector: 'app-admin-users',
  standalone: true,
  template: `
    <h2>Users</h2>
    <div class="card tw">
      <table>
        <tr><th>Name</th><th>Role</th><th>Email</th><th>Status</th><th></th></tr>
        @for (u of users(); track u.id) {
          <tr>
            <td>{{ u.name }}</td><td>{{ u.role }}</td><td>{{ u.email }}</td>
            <td><span [class]="'chip ' + u.status">{{ u.status }}</span></td>
            <td>
              @if (u.status === 'Pending') { <button class="btn sm" (click)="set(u, 'Active')">Approve</button> }
              @if (u.status === 'Active' && u.role !== 'admin') { <button class="btn bad sm" (click)="set(u, 'Suspended')">Suspend</button> }
              @if (u.status === 'Suspended') { <button class="btn sm" (click)="set(u, 'Active')">Restore</button> }
            </td>
          </tr>
        }
      </table>
    </div>
  `
})
export class AdminUsersComponent implements OnInit {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  users = signal<AdminUser[]>([]);

  async ngOnInit() { await this.load(); }
  async load() {
    try { this.users.set((await this.api.users()).filter(u => u.role !== 'admin')); }
    catch (e) { this.toast.show(errMsg(e), true); }
  }
  async set(u: AdminUser, status: 'Active' | 'Suspended') {
    try { await this.api.setUserStatus(u.id, status); this.toast.show(u.name + ': ' + status); await this.load(); }
    catch (e) { this.toast.show(errMsg(e), true); }
  }
}
