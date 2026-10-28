import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService, errMsg } from '../core/api.service';
import { Category, DAYS, Provider, SLOTS } from '../core/models';
import { ToastService } from '../core/toast.service';

@Component({
  selector: 'app-providers',
  standalone: true,
  imports: [FormsModule],
  template: `
    <h2>Find a provider</h2>
    <div class="filters">
      <select aria-label="Category" (change)="onCat($any($event.target).value)">
        <option value="">All categories</option>
        @for (c of cats(); track c.id) { <option [value]="c.id">{{ c.name }}</option> }
      </select>
      <input aria-label="Search" placeholder="Search by name or service" (input)="text.set($any($event.target).value)">
    </div>
    <div class="grid">
      @for (p of shown(); track p.id) {
        <div class="card">
          <div class="row"><h3>{{ p.name }}</h3><span class="chip">{{ p.category }}</span></div>
          <p class="mute">{{ p.description }}</p>
          @if (p.rating) { <div><span class="stars">★</span> {{ p.rating }}</div> } @else { <div class="mute">No reviews yet</div> }
          <div class="mute">{{ p.rate }}</div>
          <div class="mute">Available: {{ days(p) || 'not set' }}</div>
          <div class="acts"><button class="btn" (click)="selected.set(p)">Book</button></div>
        </div>
      } @empty {
        <p class="mute">{{ loading() ? 'Loading…' : 'No providers match.' }}</p>
      }
    </div>

    @if (selected(); as p) {
      <div class="ov" role="dialog" aria-modal="true">
        <div class="card">
          <h2>Book {{ p.name }}</h2>
          <form #f="ngForm" (ngSubmit)="book(p, f.value)">
            <label for="date">Date</label>
            <input id="date" name="date" type="date" [min]="today" ngModel required>
            <label for="slot">Time slot</label>
            <select id="slot" name="slot" [ngModel]="0">
              @for (s of SL; track $index) { <option [ngValue]="$index">{{ s }}</option> }
            </select>
            <p class="mute">Free on: {{ days(p) || 'no days set' }}</p>
            <label for="note">Notes for the provider</label>
            <textarea id="note" name="note" rows="2" ngModel></textarea>
            <div class="row mt">
              <button type="button" class="btn alt" (click)="selected.set(null)">Close</button>
              <button class="btn" [disabled]="busy() || f.invalid">Send request</button>
            </div>
          </form>
        </div>
      </div>
    }
  `
})
export class ProvidersComponent implements OnInit {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private router = inject(Router);
  SL = SLOTS;
  today = new Date().toISOString().slice(0, 10);
  cats = signal<Category[]>([]);
  list = signal<Provider[]>([]);
  cat = signal<number | null>(null);
  text = signal('');
  selected = signal<Provider | null>(null);
  loading = signal(true);
  busy = signal(false);

  shown = computed(() => {
    const t = this.text().toLowerCase();
    return this.list().filter(p => !t || (p.name + p.description + p.address).toLowerCase().includes(t));
  });

  async ngOnInit() {
    try { this.cats.set(await this.api.categories()); } catch (e) { this.toast.show(errMsg(e), true); }
    await this.load();
  }
  async load() {
    this.loading.set(true);
    try { this.list.set(await this.api.providers(this.cat() ?? undefined)); }
    catch (e) { this.toast.show(errMsg(e), true); }
    finally { this.loading.set(false); }
  }
  onCat(v: string) { this.cat.set(v ? +v : null); this.load(); }

  days(p: Provider): string {
    return [...new Set(p.availability.map(a => DAYS[a.weekday]))].join(', ');
  }

  async book(p: Provider, v: { date: string; slot: number; note: string | null }) {
    this.busy.set(true);
    try {
      await this.api.createBooking({ providerId: p.id, date: v.date, slot: Number(v.slot), note: v.note ?? '' });
      this.selected.set(null);
      this.toast.show('Booking request sent');
      await this.router.navigateByUrl('/my-bookings');
    } catch (e) {
      this.toast.show(errMsg(e), true);
    } finally {
      this.busy.set(false);
    }
  }
}
