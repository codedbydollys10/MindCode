/**
 * Keystroke Retry Queue
 * Handles failed keystroke insertions with exponential backoff
 * Persists to IndexedDB for durability across page reloads
 */

export interface QueuedKeystroke {
  id: string;
  data: Record<string, any>;
  timestamp: number;
  retryCount: number;
  nextRetryAt: number;
}

export class KeystrokeRetryQueue {
  private queue: QueuedKeystroke[] = [];
  private dbName = "keystroke_db";
  private storeName = "keystroke_queue";
  private db: IDBDatabase | null = null;
  private isOnline = true;
  private maxRetries = 5;
  private baseRetryDelay = 1000; // 1 second
  private maxRetryDelay = 60000; // 60 seconds

  constructor() {
    this.initializeDB();
    this.setupNetworkListener();
    this.startRetryWorker();
  }

  /**
   * Initialize IndexedDB for persistence
   */
  private async initializeDB(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);

      request.onerror = () => {
        console.error("[RetryQueue] IndexedDB open failed:", request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        console.log("[RetryQueue] IndexedDB initialized");
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: "id" });
          store.createIndex("nextRetryAt", "nextRetryAt", { unique: false });
          console.log("[RetryQueue] ObjectStore created");
        }
      };
    });
  }

  /**
   * Listen for network status changes
   */
  private setupNetworkListener(): void {
    window.addEventListener("online", () => {
      console.log("[RetryQueue] Network online - processing queue");
      this.isOnline = true;
      this.processQueue();
    });

    window.addEventListener("offline", () => {
      console.log("[RetryQueue] Network offline - pausing retries");
      this.isOnline = false;
    });
  }

  /**
   * Enqueue a keystroke for retry
   */
  async enqueue(data: Record<string, any>): Promise<void> {
    const item: QueuedKeystroke = {
      id: `${Date.now()}-${Math.random()}`,
      data,
      timestamp: Date.now(),
      retryCount: 0,
      nextRetryAt: Date.now(),
    };

    this.queue.push(item);

    // Persist to IndexedDB
    if (this.db) {
      try {
        await this.saveToIndexedDB(item);
      } catch (err) {
        console.error("[RetryQueue] Failed to save to IndexedDB:", err);
      }
    }

    console.log(`[RetryQueue] Enqueued keystroke (queue size: ${this.queue.length})`);
  }

  /**
   * Save item to IndexedDB
   */
  private async saveToIndexedDB(item: QueuedKeystroke): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error("IndexedDB not initialized"));
        return;
      }

      const transaction = this.db.transaction([this.storeName], "readwrite");
      const store = transaction.objectStore(this.storeName);
      const request = store.put(item);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  /**
   * Load queue from IndexedDB on initialization
   */
  async loadFromIndexedDB(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.db) {
        resolve();
        return;
      }

      const transaction = this.db.transaction([this.storeName], "readonly");
      const store = transaction.objectStore(this.storeName);
      const request = store.getAll();

      request.onsuccess = () => {
        this.queue = request.result;
        console.log(`[RetryQueue] Loaded ${this.queue.length} items from IndexedDB`);
        resolve();
      };

      request.onerror = () => {
        console.error("[RetryQueue] Failed to load from IndexedDB");
        resolve();
      };
    });
  }

  /**
   * Remove item from IndexedDB
   */
  private async removeFromIndexedDB(id: string): Promise<void> {
    return new Promise((resolve) => {
      if (!this.db) {
        resolve();
        return;
      }

      const transaction = this.db.transaction([this.storeName], "readwrite");
      const store = transaction.objectStore(this.storeName);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => {
        console.error("[RetryQueue] Failed to delete from IndexedDB");
        resolve();
      };
    });
  }

  /**
   * Calculate exponential backoff delay
   */
  private calculateBackoffDelay(retryCount: number): number {
    const delay = this.baseRetryDelay * Math.pow(2, retryCount);
    return Math.min(delay, this.maxRetryDelay);
  }

  /**
   * Process queue items that are ready for retry
   */
  private async processQueue(): Promise<void> {
    if (!this.isOnline || this.queue.length === 0) return;

    const now = Date.now();
    const readyItems = this.queue.filter((item) => item.nextRetryAt <= now);

    console.log(`[RetryQueue] Processing ${readyItems.length} ready items (total queue: ${this.queue.length})`);

    for (const item of readyItems) {
      try {
        await this.sendKeystroke(item);
        // Success - remove from queue
        this.queue = this.queue.filter((q) => q.id !== item.id);
        await this.removeFromIndexedDB(item.id);
        console.log(`[RetryQueue] ✅ Successfully sent keystroke (ID: ${item.id})`);
      } catch (error) {
        // Retry logic
        item.retryCount++;
        if (item.retryCount >= this.maxRetries) {
          console.error(`[RetryQueue] ❌ Max retries exceeded for keystroke (ID: ${item.id})`, error);
          this.queue = this.queue.filter((q) => q.id !== item.id);
          await this.removeFromIndexedDB(item.id);
        } else {
          item.nextRetryAt = now + this.calculateBackoffDelay(item.retryCount);
          await this.saveToIndexedDB(item);
          console.warn(
            `[RetryQueue] ⚠️ Retry ${item.retryCount}/${this.maxRetries} for keystroke (ID: ${item.id}), next retry in ${item.nextRetryAt - now}ms`
          );
        }
      }
    }
  }

  /**
   * Send keystroke to backend
   */
  private async sendKeystroke(item: QueuedKeystroke): Promise<void> {
    const url = `${import.meta.env.VITE_CODE_RUNNER_URL || "https://mind-code-gilt.vercel.app"}/api/keystroke-log`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(item.data),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error);
    }
  }

  /**
   * Start retry worker that processes queue periodically
   */
  private startRetryWorker(): void {
    setInterval(() => {
      if (this.isOnline && this.queue.length > 0) {
        this.processQueue();
      }
    }, 2000); // Check every 2 seconds
  }

  /**
   * Get current queue size
   */
  getQueueSize(): number {
    return this.queue.length;
  }

  /**
   * Clear entire queue
   */
  async clearQueue(): Promise<void> {
    this.queue = [];
    if (this.db) {
      const transaction = this.db.transaction([this.storeName], "readwrite");
      const store = transaction.objectStore(this.storeName);
      store.clear();
    }
    console.log("[RetryQueue] Queue cleared");
  }

  /**
   * Get queue status
   */
  getStatus() {
    return {
      queueSize: this.queue.length,
      isOnline: this.isOnline,
      items: this.queue.map((item) => ({
        id: item.id,
        retryCount: item.retryCount,
        nextRetryAt: new Date(item.nextRetryAt).toISOString(),
      })),
    };
  }
}
