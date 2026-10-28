import { Component, inject, OnInit, signal } from '@angular/core';
import { ApiService, errMsg } from '../core/api.service';
import { DAYS, SLOTS } from '../core/models';
import { ToastService } from '../core/toast.service';

@Component({
  selector: 'app-availability',
  standalone: true,
  template: `
    <h2>My weekly availability</h2>
    <p class="mute">Customers can only book the slots you tick.</p>
    <div class="card tw">
      <div class="avail">
        <span></span>
        @for (d of DAYS; track $index) { <b>{{ d }}</b> }
        @for (s of SL; track $index; let i = $index) {
          <span>{{ s }}</span>
          @for (d of DAYS; track $index; let j = $index) {
            <input type="checkbox" [attr.aria-label]="d + ' ' + s" [checked]="isOn(j, i)" (change)="toggle(j, i, $any($event.target).checked)">
          }
        }
      </div>
    </div>
    <button class="btn" (click)="save()">Save availability</button>
  `
})
export class AvailabilityComponent implements OnInit {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  DAYS = DAYS;
  SL = SLOTS;
  on = signal<Set<string>>(new Set());

  async ngOnInit() {
    try {
      const p = await this.api.providerMe();
      this.on.set(new Set(p.availability.map(a => a.weekday + '-' + a.slot)));
    } catch (e) { this.toast.show(errMsg(e), true); }
  }
  isOn(day: number, slot: number) { return this.on().has(day + '-' + slot); }
  toggle(day: number, slot: number, checked: boolean) {
    const next = new Set(this.on());
    if (checked) next.add(day + '-' + slot); else next.delete(day + '-' + slot);
    this.on.set(next);
  }
  async save() {
    const slots = [...this.on()].map(k => { const [d, s] = k.split('-'); return { weekday: +d, slot: +s }; });
    try { await this.api.saveAvailability(slots); this.toast.show('Availability saved'); }
    catch (e) { this.toast.show(errMsg(e), true); }
  }
}
