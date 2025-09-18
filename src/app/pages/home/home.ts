// src/app/pages/home/home.ts
import { Component, signal, ViewChild, AfterViewInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { UsersService, UserRow } from '../../services/users.service';
import Swal from 'sweetalert2';
import { GoogleMapsModule, GoogleMap } from '@angular/google-maps';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, GoogleMapsModule],
  templateUrl: './home.html',
  styleUrls: ['./home.scss']
})
export class Home implements AfterViewInit, OnDestroy {

  option = 'dashboard';

  // Loading
  loading = signal(false);

  // Listas
  clients       = signal<UserRow[]>([]);
  providers     = signal<UserRow[]>([]);
  repartidores  = signal<UserRow[]>([]);

  // Paginación / búsqueda
  page       = signal(1);
  perPage    = signal(10);
  totalPages = signal(1);
  totalItems = signal(0);
  search     = signal('');

  // Google Maps
  @ViewChild(GoogleMap) map!: GoogleMap;

  // Centro por defecto (Santa Marta) — se sobreescribe con geoloc si está disponible
  center: google.maps.LatLngLiteral = { lat: 11.2408, lng: -74.1990 };
  zoom = 8;
  mapOptions: google.maps.MapOptions = {
    mapTypeId: 'roadmap',
    zoomControl: true,
    scrollwheel: true,
    disableDoubleClickZoom: false,
    maxZoom: 18,
    minZoom: 3,
  };

  // Marker del sitio buscado (botón “Ir”)
  searchMarker: google.maps.LatLngLiteral | null = null;

  // Autocomplete
  private autocomplete?: google.maps.places.Autocomplete;
  private lastPlaceLoc: google.maps.LatLngLiteral | null = null;

  // función para desuscribir realtime
  private unsubRealtime?: () => void;

  constructor(private usersSvc: UsersService) {}

  async ngOnInit() {
    // Centra cerca del admin si el navegador lo permite
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => { this.center = { lat: pos.coords.latitude, lng: pos.coords.longitude }; },
        ()   => {}
      );
    }
  }

  ngAfterViewInit(): void {
    // Autocomplete (requiere &libraries=places en el script de Google Maps)
    const input = document.getElementById('place-input') as HTMLInputElement | null;
    if (input && (google.maps as any).places) {
      this.autocomplete = new google.maps.places.Autocomplete(input);
      this.autocomplete.addListener('place_changed', () => {
        const place = this.autocomplete!.getPlace();
        if (place.geometry?.location) {
          const loc = place.geometry.location;
          // Guardamos la última selección; el mapa se mueve cuando presionas "Ir"
          this.lastPlaceLoc = { lat: loc.lat(), lng: loc.lng() };
        }
      });
    }
  }

  ngOnDestroy(): void {
    this.unsubRealtime?.();
  }

  // ==================== Helpers de mapa ====================

  // Solo activos con coords válidas y distintas de 0,0 (para markers)
  get activeRepartidores(): UserRow[] {
    return this.repartidores().filter(r =>
      (r.status === 'active' || (r as any).status === true) &&
      typeof r.lat === 'number' &&
      typeof r.lng === 'number' &&
      !(r.lat === 0 && r.lng === 0)
    );
  }

  // Todos con coords (activos o no) — para listado lateral
  get usersWithCoords(): UserRow[] {
    return this.repartidores().filter(r =>
      typeof r.lat === 'number' &&
      typeof r.lng === 'number' &&
      !(r.lat === 0 && r.lng === 0)
    );
  }

  hasRepartidores(): boolean {
    return this.activeRepartidores.length > 0;
  }

  private fitMapToMarkers(): void {
    if (!this.map || this.activeRepartidores.length === 0) return;
    const bounds = new google.maps.LatLngBounds();
    this.activeRepartidores.forEach(r => bounds.extend({ lat: r.lat!, lng: r.lng! }));
    this.map.fitBounds(bounds);
    const listener = this.map.googleMap?.addListener('bounds_changed', () => {
      if ((this.map?.getZoom() ?? 12) > 16) this.map?.googleMap?.setZoom(16);
      listener?.remove();
    });
  }

  // Centrar el mapa y dejar marker en el usuario clickeado del listado lateral
  centerOnUser(u: UserRow) {
    if (typeof u.lat === 'number' && typeof u.lng === 'number') {
      this.center = { lat: u.lat, lng: u.lng };
      this.zoom = 15;
      this.searchMarker = { lat: u.lat, lng: u.lng };
    }
  }

  // Botón “Ir” — centra el mapa al último lugar elegido con Autocomplete
  goToSearch() {
    if (this.lastPlaceLoc) {
      this.center = { ...this.lastPlaceLoc };
      this.zoom = 15;
      this.searchMarker = { ...this.lastPlaceLoc };
    }
  }

  // ==================== Proveedores ====================
  async confirmProviderDecision(p: UserRow) {
    const result = await Swal.fire({
      title: 'Revisión de proveedor',
      html: `<div style="text-align:left">
              <b>Nombre:</b> ${p.name || '(sin nombre)'}<br>
              <b>Email:</b> ${p.email || '(oculto)'}<br>
              <b>Teléfono:</b> ${p.phone || '—'}
            </div>`,
      icon: 'question',
      showDenyButton: true,
      showCancelButton: true,
      confirmButtonText: 'Aprobar',
      denyButtonText: 'Denegar',
      cancelButtonText: 'Cancelar',
      reverseButtons: true,
    });
    if (!result.isConfirmed && !result.isDenied) return;
    const approve = result.isConfirmed;

    this.loading.set(true);
    try {
      await this.usersSvc.updateUserStatus(p.id, approve);
      const arr = this.providers().slice();
      const idx = arr.findIndex(u => u.id === p.id);
      if (idx >= 0) arr[idx] = { ...arr[idx], status: approve ? 'active' : 'inactive' };
      this.providers.set(arr);

      await Swal.fire({
        icon: 'success',
        title: approve ? 'Proveedor aprobado' : 'Proveedor denegado',
        timer: 1400,
        showConfirmButton: false
      });
    } catch {
      await Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo actualizar.' });
    } finally {
      this.loading.set(false);
    }
  }

  // ==================== Repartidores (alta) ====================
  async addRepartidor() {
    const { value, isConfirmed } = await Swal.fire({
      title: 'Nuevo repartidor',
      html: `
        <input id="swal-name" class="swal2-input" placeholder="Nombre completo">
        <input id="swal-email" type="email" class="swal2-input" placeholder="Correo electrónico">
        <input id="swal-phone" class="swal2-input" placeholder="Teléfono (opcional)">
      `,
      focusConfirm: false,
      showCancelButton: true,
      confirmButtonText: 'Crear',
      cancelButtonText: 'Cancelar',
      preConfirm: () => {
        const name  = (document.getElementById('swal-name')  as HTMLInputElement).value.trim();
        const email = (document.getElementById('swal-email') as HTMLInputElement).value.trim().toLowerCase();
        const phone = (document.getElementById('swal-phone') as HTMLInputElement).value.trim();
        if (!name)  return Swal.showValidationMessage('El nombre es obligatorio');
        if (!email) return Swal.showValidationMessage('El correo es obligatorio');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Swal.showValidationMessage('Correo inválido');
        return { name, email, phone };
      }
    });
    if (!isConfirmed || !value) return;

    this.loading.set(true);
    try {
      const password = 'temporal';
      const created = await this.usersSvc.registerUser(value.email, password, 'repartidor');
      if (created?.id && (this.usersSvc as any).updateUser) {
        await (this.usersSvc as any).updateUser(created.id, {
          name: value.name, phone: value.phone ?? '', status: true
        });
      }
      await Swal.fire({
        icon: 'success',
        title: 'Repartidor creado',
        html: `<div style="text-align:left">
                <b>Nombre:</b> ${value.name}<br>
                <b>Email:</b> ${value.email}<br>
                <b>Contraseña temporal:</b> <code>${password}</code>
              </div>`
      });

      if (this.option === 'repartidores') await this.loadRepartidores();
    } catch (e: any) {
      await Swal.fire({ icon: 'error', title: 'No se pudo crear el repartidor', text: e?.message ?? 'Error desconocido' });
    } finally {
      this.loading.set(false);
    }
  }

  // ==================== Carga y realtime de repartidores ====================
  private async loadRepartidores() {
    this.loading.set(true);
    try {
      const res = await this.usersSvc.listUsersByType(['repartidor'], 1, 200);
      this.repartidores.set(res.items);
      this.fitMapToMarkers();

      // Re-suscribe realtime (IMPORTANTE: usar await)
      this.unsubRealtime?.();
      this.unsubRealtime = await this.usersSvc.subscribeRepartidoresRealtime((e: any) => {
        const rec = e.record;

        const status: 'active' | 'inactive' =
          (rec.status === true || rec.status === 'active') ? 'active' : 'inactive';

        const lat = typeof rec.lat === 'number' ? rec.lat : undefined;
        const lng = typeof rec.long === 'number' ? rec.long : undefined; // PB usa 'long' → mapeamos a 'lng'

        const updated: UserRow = {
          id: rec.id,
          created: rec.created,
          name: rec.name ?? rec.username ?? '(sin nombre)',
          email: rec.emailVisibility ? rec.email : undefined,
          phone: rec.phone ?? '',
          status,
          type: rec.type ?? rec.rolw,
          lat, lng,
          avatarUrl: undefined,
        };

        const arr = this.repartidores().slice();
        const idx = arr.findIndex(r => r.id === rec.id);

        if (e.action === 'delete') {
          if (idx >= 0) { arr.splice(idx, 1); this.repartidores.set(arr); }
          return;
        }

        if (idx >= 0) {
          arr[idx] = { ...arr[idx], ...updated };
          this.repartidores.set(arr);
        } else {
          this.repartidores.set([updated, ...arr]);
        }

        this.fitMapToMarkers();
      });
    } finally {
      this.loading.set(false);
    }
  }

  // ==================== Navegación / Listas ====================
  setOption(option: string) {
    this.option = option;
    this.page.set(1);
    if (option === 'repartidores') this.loadRepartidores();
    else this.loadData();
  }

  async loadData() {
    this.loading.set(true);
    try {
      if (this.option === 'proveedores') {
        const res = await this.usersSvc.listProviders(this.page(), this.perPage(), this.search());
        this.providers.set(res.items);
        this.totalPages.set(res.totalPages);
        this.totalItems.set(res.totalItems);
      } else if (this.option === 'clientes') {
        const res = await this.usersSvc.listClients(this.page(), this.perPage(), this.search());
        this.clients.set(res.items);
        this.totalPages.set(res.totalPages);
        this.totalItems.set(res.totalItems);
      }
    } finally {
      this.loading.set(false);
    }
  }
// Devuelve true si el usuario está activo (soporta boolean o 'active')
isActive(u: UserRow): boolean {
  // status puede venir como boolean (PB) o como 'active'/'inactive'
  return u.status === 'active' || (u as any)?.status === true;
}

  async onSearch(term: string) {
    this.search.set(term.trim());
    this.page.set(1);
    await this.loadData();
  }

  async goToPage(p: number) {
    if (p < 1 || p > this.totalPages()) return;
    this.page.set(p);
    await this.loadData();
  }

  statusBadgeClass(u: UserRow) {
    return u.status === 'active' ? 'badge bg-success' : 'badge bg-warning';
  }

  trackById(_idx: number, u: UserRow) { return u.id; }

  onImgError(event: Event) {
    (event.target as HTMLImageElement).src = 'assets/img/placeholder-user.png';
  }
}
