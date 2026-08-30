const axios = require('axios');
const config = require('../config');

class HiggsfieldClient {
  /**
   * Generates a video/image by delegating to live Higgsfield endpoints
   * or executing a realistic simulated pipeline if in mock mode.
   */
  async generate(jobData, onProgress) {
    if (config.mockMode || (!config.apiToken && !config.sessionCookies)) {
      return this._simulateGeneration(jobData, onProgress);
    }
    return this._liveGeneration(jobData, onProgress);
  }

  async _liveGeneration(jobData, onProgress) {
    onProgress(15, 'Authenticating with shared Higgsfield credentials...');

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Referer': `${config.hfTargetUrl}/`,
      'Origin': config.hfTargetUrl
    };

    if (config.sessionCookies) {
      headers['Cookie'] = config.sessionCookies;
    }
    if (config.apiToken) {
      headers['Authorization'] = config.apiToken.startsWith('Bearer ')
        ? config.apiToken
        : `Bearer ${config.apiToken}`;
    }

    onProgress(30, 'Dispatching generation request to Higgsfield cluster...');

    try {
      // Higgsfield generation API endpoint
      const response = await axios.post(`${config.hfTargetUrl}/api/v1/generate`, {
        prompt: jobData.prompt,
        model: jobData.model,
        aspect_ratio: jobData.aspectRatio,
        duration: jobData.duration,
        camera_motion: jobData.cameraMotion
      }, {
        headers,
        timeout: 120000
      });

      const data = response.data;
      const taskId = data.id || data.task_id || data.generation_id;

      if (!taskId && data.output_url) {
        onProgress(100, 'Generation finished');
        return {
          type: 'video',
          url: data.output_url,
          thumbnail: data.thumbnail_url || null,
          prompt: jobData.prompt,
          model: jobData.model
        };
      }

      // Poll status
      return await this._pollJobStatus(taskId, headers, onProgress, jobData);
    } catch (err) {
      console.warn('[Higgsfield Client] Live API error:', err.response?.data || err.message);
      // If live fails with 401 or auth missing, provide clear feedback
      if (err.response?.status === 401 || err.response?.status === 403) {
        throw new Error('Higgsfield Authentication Failed: Shared session cookies or API token are invalid or expired.');
      }
      throw new Error(`Higgsfield generation failed: ${err.response?.data?.message || err.message}`);
    }
  }

  async _pollJobStatus(taskId, headers, onProgress, jobData) {
    let attempts = 0;
    const maxAttempts = 60; // 2 minutes

    while (attempts < maxAttempts) {
      await new Promise(r => setTimeout(r, 2000));
      attempts++;

      const progressEstimate = Math.min(95, 30 + Math.floor(attempts * 1.5));
      onProgress(progressEstimate, `Processing video frames (${attempts}/${maxAttempts})...`);

      try {
        const res = await axios.get(`${config.hfTargetUrl}/api/v1/tasks/${taskId}`, { headers });
        const task = res.data;

        if (task.status === 'completed' || task.status === 'succeeded') {
          onProgress(100, 'Rendering complete!');
          return {
            type: 'video',
            url: task.output_url || task.video_url || task.result_url,
            thumbnail: task.thumbnail_url || null,
            prompt: jobData.prompt,
            model: jobData.model,
            duration: jobData.duration
          };
        }

        if (task.status === 'failed') {
          throw new Error(task.error || 'Video generation failed on Higgsfield server.');
        }
      } catch (pollErr) {
        console.warn(`[Poll attempt ${attempts} warning]:`, pollErr.message);
      }
    }

    throw new Error('Higgsfield task timed out after 120s.');
  }

  /**
   * High-fidelity simulated generation for instant development & showcase
   */
  async _simulateGeneration(jobData, onProgress) {
    const sampleVideos = [
      'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
      'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
      'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4',
      'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyBlazes.mp4'
    ];

    const stages = [
      { pct: 20, stage: 'Token injected • Parsing prompt semantics' },
      { pct: 45, stage: 'Diffusing latent motion vectors' },
      { pct: 70, stage: 'Upscaling cinematic frames & color grading' },
      { pct: 90, stage: 'Encoding MP4 stream & generating preview' },
      { pct: 100, stage: 'Ready' }
    ];

    for (const step of stages) {
      await new Promise(r => setTimeout(r, 700));
      onProgress(step.pct, step.stage);
    }

    const randomVideo = sampleVideos[Math.floor(Math.random() * sampleVideos.length)];

    return {
      type: 'video',
      url: randomVideo,
      thumbnail: `https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600&auto=format&fit=crop&q=80`,
      prompt: jobData.prompt,
      model: jobData.model,
      aspectRatio: jobData.aspectRatio,
      duration: jobData.duration,
      cameraMotion: jobData.cameraMotion,
      simulated: true
    };
  }
}

module.exports = new HiggsfieldClient();
