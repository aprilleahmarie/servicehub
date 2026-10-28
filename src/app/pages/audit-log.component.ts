import { DatePipe } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { ApiService, errMsg } from '../core/api.service';
import { AuditEntry } from '../core/models';
import { ToastService } from '../core/toast.service';

@Component({
  selector: 'app-audit-log',
  standalone: true,
  imports: [DatePipe],
  template: `
    <h2>Audit log</h2>
    <div class="card tw">
      <table>
        <tr><th>Time</th><th>User</th><th>Action</th><th>Record</th><th>IP</th><th>Detail</th></tr>
        @for (x of logs(); track x.id) {
          <tr>
            <td>{{ x.created_at | date: 'medium' }}</td><td>{{ x.user_id }}</td><td>{{ x.action }}</td>
            <td>{{ x.entity }} {{ x.entity_id }}</td><td>{{ x.ip }}</td><td>{{ x.detail }}</td>
          </tr>
        }
      </table>
    </div>
  `
})
export class AuditLogComponent implements OnInit {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  logs = signal<AuditEntry[]>([]);

  async ngOnInit() {
    try { this.logs.set(await this.api.auditLogs()); } catch (e) { this.toast.show(errMsg(e), true); }
  }
}
