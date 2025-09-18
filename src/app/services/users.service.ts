// src/app/services/users.service.ts
import { Injectable } from '@angular/core';
import PocketBase, { RecordModel } from 'pocketbase';

export interface UserRow {
  id: string;
  created: string; // ISO
  name: string;
  email?: string;
  type?: string;
  phone?: string;
  avatarUrl?: string;
  lat?: number;
  lng?: number;
  status?: 'active' | 'inactive'; // mapeo UI (PB guarda boolean u otras variantes)
}

@Injectable({ providedIn: 'root' })
export class UsersService {



  private pb = new PocketBase('https://db.buckapi.com:8090'); // tu URL PB

  // --- Helpers --------------------------------------------------------------

  /** Username simple y único a partir del email */
  private uniqueUsernameFromEmail(email: string) {
    const left = email.split('@')[0].replace(/[^a-z0-9]/gi, '').slice(0, 20);
    const rnd  = Math.random().toString(36).slice(2, 6);
    return `${left || 'user'}_${rnd}`.toLowerCase();
  }
// users.service.ts
subscribeRepartidoresRealtime(cb: (e: any) => void) {
  // filtra por rol/typo repartidor desde el servidor (si tu PB lo soporta),
  // si no, igual filtramos en el cliente.
  
  return this.pb.collection('users').subscribe('*', cb);
}

  private getAvatarUrl(r: RecordModel, fileName?: string, size = '100x100') {
    if (!fileName) return 'assets/img/placeholder-user.png';
    try { return this.pb.files.getUrl(r, fileName, { thumb: size }); }
    catch { return 'assets/img/placeholder-user.png'; }
  }

  /** Normaliza status de PB (boolean/'active'/'inactive'/undefined) a UI */
  private normalizeStatus(s: any): 'active' | 'inactive' {
    // Si PB usa boolean:
    if (typeof s === 'boolean') return s ? 'active' : 'inactive';
    // Si en algún caso guardas string:
    if (s === 'active' || s === 'inactive') return s;
    return 'inactive';
  }

  // --- Auth/Admin opcional --------------------------------------------------

  async adminAuth(email: string, password: string) {
    await this.pb.admins.authWithPassword(email, password);
  }

  // --- Crear / Actualizar ---------------------------------------------------

  /**
   * Crea un usuario en la colección Auth "users" (PocketBase).
   * Requisitos PB: email, password, passwordConfirm (+ normalmente username).
   * @param role  tu rol lógico (ej. 'repartidor'|'provider'|'client'|'admin')
   * @param extra datos adicionales para tu esquema
   */
  async registerUser(
    email: string,
    password: string,
    role: 'repartidor' | 'provider' | 'client' | 'admin' | string,
    extra?: { name?: string; phone?: string; emailVisibility?: boolean; status?: boolean }
  ) {
    const body: any = {
      email,
      username: this.uniqueUsernameFromEmail(email), // ✅ requerido por PB
      password,
      passwordConfirm: password,                     // ✅ requerido por PB

      // Campos de negocio (ajusta a tu schema):
      type: role,                                    // texto libre
      rolw: role,                                    // select (asegúrate de tener la opción en PB)
      name: extra?.name ?? '',
      phone: extra?.phone ?? '',

      // En tu PB el status parece boolean (icono de ojo → field visible):
      status: typeof extra?.status === 'boolean' ? extra!.status : true,

      // PB: controla si el email es visible cuando listamos (lo usas en el mapping)
      emailVisibility: extra?.emailVisibility ?? false,
    };

    // Reglas de API: si la colección exige auth de admin para crear,
    // debes haber llamado a adminAuth() antes o hacerlo desde tu backend.
    const record = await this.pb.collection('users').create(body);
    return record;
  }

  /** Actualiza campos arbitrarios del usuario */
  async updateUser(userId: string, data: Partial<Record<string, any>>) {
    return await this.pb.collection('users').update(userId, data);
  }

  /** Aprueba/deniega → status boolean en PB */
  async updateUserStatus(userId: string, approved: boolean) {
    return await this.pb.collection('users').update(userId, { status: approved });
  }

  // --- Listados -------------------------------------------------------------

  /**
   * Lista usuarios por type/rolw (acepta múltiples valores y busca por name/username/email)
   * Usa OR sobre `type` y `rolw` para mayor compatibilidad con tu schema.
   */
  async listUsersByType(
    types: Array<string>, // p.ej. ['client','cliente'] o ['provider','proveedor']
    page = 1,
    perPage = 10,
    search = ''
  ): Promise<{ items: UserRow[]; page: number; perPage: number; totalItems: number; totalPages: number; }> {

    // (type = "X" || rolw = "X") OR ...
    const typeOrRolw = types
      .map(t => `(type = "${t}" || rolw = "${t}")`)
      .join(' || ');
    const typeFilter = `(${typeOrRolw})`;

    const extraSearch = search
      ? ` && (name ~ "${search}" || username ~ "${search}" || email ~ "${search}")`
      : '';

    const res = await this.pb.collection('users').getList(page, perPage, {
      filter: typeFilter + extraSearch,
      sort: '-created',
      // incluye avatar para construir URL
      fields: 'id,created,name,username,email,emailVisibility,phone,avatar,status,type,rolw,lat,long'
    });

    // const items: UserRow[] = res.items.map((r: any) => {
    //   const email = r.emailVisibility ? r.email : undefined;
    //   return {
    //     id: r.id,
    //     created: r.created,
    //     name: r.name ?? r.username ?? '(sin nombre)',
    //     email,
    //     phone: r.phone || '',
    //     avatarUrl: this.getAvatarUrl(r, r.avatar),
    //     status: this.normalizeStatus(r.status),
    //     type: r.type ?? r.rolw,
    //   };
    // });
    
    const items: UserRow[] = res.items.map((r: any) => {
      const email = r.emailVisibility ? r.email : undefined;
      return {
        id: r.id,
        created: r.created,
        name: r.name ?? r.username ?? '(sin nombre)',
        email,
        phone: r.phone || '',
        avatarUrl: this.getAvatarUrl(r, r.avatar),
        status: (r.status === true || r.status === 'active') ? 'active' : 'inactive',
        type: r.type ?? r.rolw,
        lat: typeof r.lat === 'number' ? r.lat : undefined,
        lng: typeof r.long === 'number' ? r.long : undefined, // 👈 mapear long → lng
      };
    });

    return {
      items,
      page: res.page,
      perPage: res.perPage,
      totalItems: res.totalItems,
      totalPages: res.totalPages,
    };
  }

  /** CLIENTES (cubre español/inglés) */
  listClients(page = 1, perPage = 10, search = '') {
    return this.listUsersByType(['client', 'cliente'], page, perPage, search);
  }

  /** PROVEEDORES (cubre español/inglés) */
  listProviders(page = 1, perPage = 10, search = '') {
    return this.listUsersByType(['provider', 'proveedor'], page, perPage, search);
  }

  /** REPARTIDORES */
  listRepartidores(page = 1, perPage = 10, search = '') {
    // admite tanto en type como en rolw
    return this.listUsersByType(['repartidor', 'repartidores'], page, perPage, search);
  }
}
