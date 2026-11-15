/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

const DB_NAME = 'melodex_soundfonts_db';
const DB_VERSION = 1;
const STORE_NAME = 'soundfonts';

interface StoredSoundFont {
  id: string;
  name: string;
  buffer: ArrayBuffer;
  size: number;
  updatedAt: number;
}

class SoundFontStorage {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private openDB(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      if (typeof window === 'undefined' || !window.indexedDB) {
        reject(new Error('IndexedDB is not supported in this browser.'));
        return;
      }

      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });

    return this.dbPromise;
  }

  /**
   * Retrieves a SoundFont ArrayBuffer from persistent IndexedDB
   */
  public async getSoundFont(id: string): Promise<ArrayBuffer | null> {
    const res = await this.getSoundFontWithMeta(id);
    return res ? res.buffer : null;
  }

  public async getSoundFontWithMeta(id: string): Promise<{ name: string; buffer: ArrayBuffer } | null> {
    try {
      const db = await this.openDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(id);

        request.onsuccess = () => {
          const item = request.result as StoredSoundFont | undefined;
          resolve(item ? { name: item.name, buffer: item.buffer } : null);
        };

        request.onerror = () => {
          reject(request.error);
        };
      });
    } catch (e) {
      console.warn('[SoundFontStorage] Error reading from IndexedDB:', e);
      return null;
    }
  }

  /**
   * Saves a SoundFont ArrayBuffer into persistent IndexedDB
   */
  public async saveSoundFont(id: string, name: string, buffer: ArrayBuffer): Promise<void> {
    try {
      const db = await this.openDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const item: StoredSoundFont = {
          id,
          name,
          buffer: buffer.slice(0), // clone buffer
          size: buffer.byteLength,
          updatedAt: Date.now()
        };

        const request = store.put(item);

        request.onsuccess = () => {
          resolve();
        };

        request.onerror = () => {
          reject(request.error);
        };
      });
    } catch (e) {
      console.warn('[SoundFontStorage] Error saving to IndexedDB:', e);
    }
  }

  /**
   * Checks if a SoundFont is already cached in IndexedDB
   */
  public async hasSoundFont(id: string): Promise<boolean> {
    try {
      const db = await this.openDB();
      return new Promise((resolve) => {
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.count(IDBKeyRange.only(id));

        request.onsuccess = () => {
          resolve(request.result > 0);
        };

        request.onerror = () => {
          resolve(false);
        };
      });
    } catch {
      return false;
    }
  }

  /**
   * Lists all cached SoundFonts in local storage
   */
  public async listSoundFonts(): Promise<{ id: string; name: string; size: number; updatedAt: number }[]> {
    try {
      const db = await this.openDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();

        request.onsuccess = () => {
          const items = (request.result as StoredSoundFont[]) || [];
          resolve(
            items.map((i) => ({
              id: i.id,
              name: i.name,
              size: i.size,
              updatedAt: i.updatedAt
            }))
          );
        };

        request.onerror = () => {
          reject(request.error);
        };
      });
    } catch {
      return [];
    }
  }

  /**
   * Removes a SoundFont from IndexedDB
   */
  public async deleteSoundFont(id: string): Promise<void> {
    try {
      const db = await this.openDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(id);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (e) {
      console.warn('[SoundFontStorage] Error deleting from IndexedDB:', e);
    }
  }
}

export const soundFontStorage = new SoundFontStorage();
