const { v4: uuidv4 } = require('uuid');
const config = require('../config');

class QueueManager {
  constructor() {
    this.queue = [];
    this.activeJobs = new Map();
    this.history = [];
    this.maxHistory = 50;
    this.processorRunning = false;
  }

  enqueue(jobData, runnerFn) {
    const id = uuidv4();
    const job = {
      id,
      prompt: jobData.prompt,
      model: jobData.model || 'hf-cinema-v2',
      aspectRatio: jobData.aspectRatio || '16:9',
      duration: jobData.duration || '5s',
      cameraMotion: jobData.cameraMotion || 'None',
      status: 'queued', // queued | running | completed | failed
      progress: 0,
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      result: null,
      error: null,
      runnerFn
    };

    this.queue.push(job);
    this._processNext();
    return this._sanitizeJob(job);
  }

  getJob(id) {
    const active = this.activeJobs.get(id);
    if (active) return this._sanitizeJob(active);

    const queued = this.queue.find(j => j.id === id);
    if (queued) return this._sanitizeJob(queued);

    const completed = this.history.find(j => j.id === id);
    if (completed) return completed;

    return null;
  }

  getAllJobs() {
    return {
      active: Array.from(this.activeJobs.values()).map(j => this._sanitizeJob(j)),
      queued: this.queue.map(j => this._sanitizeJob(j)),
      history: this.history
    };
  }

  getStats() {
    return {
      activeCount: this.activeJobs.size,
      queuedCount: this.queue.length,
      historyCount: this.history.length,
      maxConcurrent: config.maxConcurrentJobs
    };
  }

  async _processNext() {
    if (this.activeJobs.size >= config.maxConcurrentJobs || this.queue.length === 0) {
      return;
    }

    const job = this.queue.shift();
    if (!job) return;

    job.status = 'running';
    job.startedAt = new Date().toISOString();
    job.progress = 10;
    this.activeJobs.set(job.id, job);

    const updateProgress = (pct, stage) => {
      job.progress = Math.min(100, Math.max(0, pct));
      if (stage) job.stage = stage;
    };

    try {
      const result = await job.runnerFn(job, updateProgress);
      job.status = 'completed';
      job.progress = 100;
      job.completedAt = new Date().toISOString();
      job.result = result;
    } catch (err) {
      console.error(`[Queue] Job ${job.id} failed:`, err.message);
      job.status = 'failed';
      job.error = err.message || 'Execution error';
      job.completedAt = new Date().toISOString();
    } finally {
      this.activeJobs.delete(job.id);
      const sanitized = this._sanitizeJob(job);
      this.history.unshift(sanitized);
      if (this.history.length > this.maxHistory) {
        this.history.pop();
      }
      // Process next available item in queue
      setImmediate(() => this._processNext());
    }
  }

  _sanitizeJob(job) {
    const { runnerFn, ...clean } = job;
    return clean;
  }
}

module.exports = new QueueManager();
