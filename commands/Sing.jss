const ytdl = require('../france/Yt');
const yts = require('yt-search');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const mm = require('music-metadata');
const ffmpeg = require('fluent-ffmpeg');

// Helper: Check if MP3 buffer is valid
async function isValidMp3Buffer(buffer) {
  try {
    const metadata = await mm.parseBuffer(buffer, 'audio/mpeg');
    return metadata.format.container === 'MPEG' && metadata.format.duration > 0;
  } catch {
    return false;
  }
}

// Helper: Wait until FFmpeg output file stabilizes
async function waitForFileToStabilize(filePath, timeout = 5000) {
  let lastSize = -1;
  let stableCount = 0;
  const interval = 200;

  return new Promise((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(async () => {
      try {
        const { size } = await fs.promises.stat(filePath);
        if (size === lastSize) {
          stableCount++;
          if (stableCount >= 3) {
            clearInterval(timer);
            return resolve();
          }
        } else {
          stableCount = 0;
          lastSize = size;
        }

        if (Date.now() - start > timeout) {
          clearInterval(timer);
          return reject(new Error("File stabilization timed out."));
        }
      } catch (err) {}
    }, interval);
  });
}

// Helper: Re-encode buffer using FFmpeg to make WhatsApp-compatible
async function reencodeMp3(buffer) {
  const inputPath = path.join(__dirname, 'input.mp3');
  const outputPath = path.join(__dirname, 'output.mp3');
  fs.writeFileSync(inputPath, buffer);

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .audioCodec('libmp3lame')
      .audioBitrate('128k')
      .audioFrequency(44100)
      .on('end', async () => {
        try {
          await waitForFileToStabilize(outputPath);
          const fixedBuffer = fs.readFileSync(outputPath);
          resolve(fixedBuffer);
        } catch (err) {
          reject(err);
        }
      })
      .on('error', reject)
      .save(outputPath);
  });
}

// Main Command
module.exports = {
  name: 'sing',
  aliases: ['yt', 'song'],
  description: 'Play and download YouTube audio from link or search query.',
  category: 'Media',

  execute: async (king, msg, args, fromJid) => {
    if (!args.length) {
      return king.sendMessage(fromJid, {
        text: '🎵 *Provide a YouTube link or search query.*\nExample: `.sing Shape of You`'
      }, { quoted: msg });
    }

    let query = args.join(' ');
    let url = '';

    try {
      // Check if it's a YouTube URL
      if (query.includes('youtube.com') || query.includes('youtu.be')) {
        url = query;
      } else {
        // Search YouTube
        const result = await yts(query);
        if (!result.videos.length) {
          return king.sendMessage(fromJid, {
            text: '❌ No results found for your query.'
          }, { quoted: msg });
        }
        const video = result.videos[0];
        url = video.url;
        query = video.title;
      }

      // Download MP3 URL
      const { mp3 } = await ytdl(url);
      if (!mp3) {
        return king.sendMessage(fromJid, {
          text: '⚠️ Failed to download audio. Try another link or query.'
        }, { quoted: msg });
      }

      // Download audio as buffer
      const response = await axios.get(mp3, {
        responseType: 'arraybuffer',
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      const audioBuffer = Buffer.from(response.data);

      // Validate audio
      let finalBuffer = audioBuffer;
      const isValid = await isValidMp3Buffer(audioBuffer);
      if (!isValid) {
        await king.sendMessage(fromJid, {
          text: '🔧 Re-encoding audio for WhatsApp compatibility...'
        }, { quoted: msg });

        try {
          finalBuffer = await reencodeMp3(audioBuffer);
        } catch (err) {
          return king.sendMessage(fromJid, {
            text: '❌ Re-encoding failed. Please try another song.'
          }, { quoted: msg });
        }
      }

      // Send audio file
      await king.sendMessage(fromJid, {
        audio: finalBuffer,
        mimetype: 'audio/mpeg',
        ptt: false,
        fileName: `${query}.mp3`
      }, { quoted: msg });

    } catch (err) {
      console.error('Error in sing command:', err);
      return king.sendMessage(fromJid, {
        text: '❌ Something went wrong while processing your request.'
      }, { quoted: msg });
    }
  }
};
