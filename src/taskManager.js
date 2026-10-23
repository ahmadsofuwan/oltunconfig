/**
 * Background Task Manager untuk GPON Manager Tool
 * Mengelola antrean dan status proses asynchronous (registrasi & hapus ONU via SSH)
 */

class TaskManager {
  constructor() {
    this.tasks = new Map();
    // Jalankan pembersihan task kedaluwarsa secara berkala (setiap 10 menit)
    setInterval(() => this.cleanupOldTasks(), 10 * 60 * 1000);
  }

  /**
   * Membuat task baru
   * @param {string} type - 'register' | 'delete'
   * @param {object} metadata - Informasi parameter (card, port, onuId, sn, dll)
   * @returns {object} task
   */
  createTask(type, metadata = {}) {
    const id = `task_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const task = {
      id,
      type,
      status: "pending", // 'pending' | 'running' | 'completed' | 'failed'
      progress: 0,
      message: "Tugas sedang diantrekan...",
      step: 0,
      totalSteps: 0,
      metadata: { ...metadata },
      output: "",
      result: null,
      error: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
    };

    this.tasks.set(id, task);
    return task;
  }

  /**
   * Mengambil task berdasarkan ID
   * @param {string} id
   * @returns {object|null}
   */
  getTask(id) {
    return this.tasks.get(id) || null;
  }

  /**
   * Memperbarui informasi task
   * @param {string} id
   * @param {object} updates
   * @returns {object|null}
   */
  updateTask(id, updates = {}) {
    const task = this.tasks.get(id);
    if (!task) return null;

    Object.assign(task, updates, {
      updatedAt: new Date().toISOString(),
    });

    if (updates.status === "completed" || updates.status === "failed") {
      task.completedAt = new Date().toISOString();
      if (updates.status === "completed" && updates.progress === undefined) {
        task.progress = 100;
      }
    }

    return task;
  }

  /**
   * Mengambil daftar seluruh task aktif
   * @returns {Array<object>}
   */
  listTasks() {
    return Array.from(this.tasks.values()).sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );
  }

  /**
   * Menghapus task yang berumur lebih dari 1 jam untuk mencegah memory leak
   */
  cleanupOldTasks() {
    const ONE_HOUR = 60 * 60 * 1000;
    const now = Date.now();
    for (const [id, task] of this.tasks.entries()) {
      const createdTime = new Date(task.createdAt).getTime();
      if (now - createdTime > ONE_HOUR) {
        this.tasks.delete(id);
      }
    }
  }
}

// Singleton Task Manager
const taskManager = new TaskManager();

module.exports = taskManager;
