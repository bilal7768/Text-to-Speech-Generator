import React, { useState, useRef } from 'react';
import { GoogleGenAI, Modality } from '@google/genai';
import { SpeakerWaveIcon, LoadingSpinnerIcon, DownloadIcon } from './components/Icons';

// Helper function to decode base64 string to Uint8Array
function decode(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// Helper function to decode raw PCM audio data into an AudioBuffer
async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

// Helper function to convert an AudioBuffer to a WAV file Blob
function bufferToWave(buffer: AudioBuffer): Blob {
    const numOfChan = buffer.numberOfChannels;
    const length = buffer.length * numOfChan * 2 + 44;
    const bufferArray = new ArrayBuffer(length);
    const view = new DataView(bufferArray);
    const channels = [];
    let i, sample;
    let offset = 0;
    let pos = 0;

    // write WAVE header
    setUint32(0x46464952, 36 + buffer.length * 2); // "RIFF"
    setUint32(0x45564157, null); // "WAVE"
    setUint32(0x20746d66, 16); // "fmt " chunk
    setUint16(1, null); // PCM
    setUint16(numOfChan, null);
    setUint32(buffer.sampleRate, null);
    setUint32(buffer.sampleRate * 2 * numOfChan, null); // byte rate
    setUint16(numOfChan * 2, null); // block align
    setUint16(16, null); // bits per sample
    setUint32(0x61746164, buffer.length * 2 * numOfChan); // "data" chunk size

    function setUint16(data: number, p: number | null) {
        view.setUint16(pos, data, true);
        pos += 2;
    }

    function setUint32(data: number, p: number | null) {
        view.setUint32(pos, data, true);
        pos += 4;
    }

    // write interleaved data
    for (i = 0; i < buffer.numberOfChannels; i++)
        channels.push(buffer.getChannelData(i));

    while (pos < length) {
        for (i = 0; i < numOfChan; i++) { // interleave channels
            sample = Math.max(-1, Math.min(1, channels[i][offset])); // clamp
            sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0; // scale to 16-bit signed int
            view.setInt16(pos, sample, true); // write 16-bit sample
            pos += 2;
        }
        offset++; // next source sample
    }

    return new Blob([view], { type: 'audio/wav' });
}


const voices = [
  { id: 'Kore', name: 'Kore' },
  { id: 'Puck', name: 'Puck' },
  { id: 'Charon', name: 'Charon' },
  { id: 'Fenrir', name: 'Fenrir' },
  { id: 'Zephyr', name: 'Zephyr' },
];

const languages = [
    { code: 'en-US', name: 'English' },
    { code: 'es-ES', name: 'Spanish' },
    { code: 'fr-FR', name: 'French' },
    { code: 'de-DE', name: 'German' },
    { code: 'hi-IN', name: 'Hindi' },
    { code: 'it-IT', name: 'Italian' },
    { code: 'ja-JP', name: 'Japanese' },
    { code: 'pt-BR', name: 'Portuguese' },
    { code: 'ru-RU', name: 'Russian' },
    { code: 'zh-CN', name: 'Chinese (Mandarin)' },
];


const App: React.FC = () => {
  const [text, setText] = useState('');
  const [selectedVoice, setSelectedVoice] = useState(voices[0].id);
  const [selectedLanguage, setSelectedLanguage] = useState(languages[0].name);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);

  const handleGenerateSpeech = async () => {
    if (!text.trim()) {
      setError("Please enter some text to generate speech.");
      return;
    }
    if (!process.env.API_KEY) {
      setError("API_KEY environment variable not set.");
      return;
    }

    setIsLoading(true);
    setError(null);
    setAudioBuffer(null);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      // Prepend the language instruction to the user's text
      const prompt = `Say in ${selectedLanguage}: ${text}`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: prompt }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: selectedVoice },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

      if (base64Audio) {
        if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
          await audioContextRef.current.close();
        }
        
        const outputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        audioContextRef.current = outputAudioContext;

        const buffer = await decodeAudioData(
          decode(base64Audio),
          outputAudioContext,
          24000,
          1,
        );

        setAudioBuffer(buffer);

        const source = outputAudioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(outputAudioContext.destination);
        source.start();

      } else {
        throw new Error("No audio data received from the API.");
      }

    } catch (err) {
      console.error("Speech generation error:", err);
      let errorMessage = "An unknown error occurred during speech generation.";
      if (err instanceof Error) {
        errorMessage = err.message;
      }
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownload = () => {
    if (!audioBuffer) {
        setError("No audio available to download.");
        return;
    };
    try {
        const wavBlob = bufferToWave(audioBuffer);
        const url = URL.createObjectURL(wavBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'speech.wav';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (err) {
        console.error("Download error:", err);
        setError("Failed to prepare audio for download.");
    }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 font-sans p-4">
      <div className="w-full max-w-2xl bg-gray-800 rounded-2xl shadow-2xl p-6 md:p-8 space-y-6 border border-gray-700">
        <header className="text-center">
          <h1 className="text-3xl md:text-4xl font-bold text-cyan-400">Text-to-Speech Generator</h1>
          <p className="text-gray-400 mt-2">Convert your text into lifelike speech in multiple languages.</p>
        </header>

        {error && (
            <div className="bg-red-900/50 border border-red-700 text-red-300 px-4 py-3 rounded-lg" role="alert">
                <strong className="font-bold">Error: </strong>
                <span className="block sm:inline">{error}</span>
            </div>
        )}

        <div className="space-y-4">
            <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Type or paste your text here..."
                className="w-full h-40 p-3 bg-gray-900 border border-gray-700 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 transition-colors text-gray-200 resize-none"
                aria-label="Text to convert to speech"
            />
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                 <div>
                    <label htmlFor="language-select" className="block text-sm font-medium text-gray-400 mb-1">Language</label>
                    <select
                        id="language-select"
                        value={selectedLanguage}
                        onChange={(e) => setSelectedLanguage(e.target.value)}
                        className="w-full p-2 bg-gray-700 border border-gray-600 rounded-md focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 transition-colors"
                    >
                        {languages.map((lang) => (
                            <option key={lang.code} value={lang.name}>{lang.name}</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label htmlFor="voice-select" className="block text-sm font-medium text-gray-400 mb-1">Voice</label>
                    <select
                        id="voice-select"
                        value={selectedVoice}
                        onChange={(e) => setSelectedVoice(e.target.value)}
                        className="w-full p-2 bg-gray-700 border border-gray-600 rounded-md focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 transition-colors"
                    >
                        {voices.map((voice) => (
                            <option key={voice.id} value={voice.id}>{voice.name}</option>
                        ))}
                    </select>
                </div>
            </div>
            <div className="flex flex-col sm:flex-row items-center gap-4 pt-2">
                <button
                    onClick={handleGenerateSpeech}
                    disabled={isLoading || !text.trim()}
                    className="w-full sm:w-auto flex-grow flex items-center justify-center gap-2 px-6 py-2.5 bg-cyan-500 text-white font-semibold rounded-lg hover:bg-cyan-600 disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors focus:outline-none focus:ring-4 focus:ring-cyan-300 focus:ring-opacity-50"
                >
                    {isLoading ? (
                        <>
                            <LoadingSpinnerIcon />
                            Generating...
                        </>
                    ) : (
                        <>
                            <SpeakerWaveIcon />
                            Generate Speech
                        </>
                    )}
                </button>
                {audioBuffer && (
                     <button
                        onClick={handleDownload}
                        disabled={isLoading}
                        className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-2.5 bg-gray-600 text-white font-semibold rounded-lg hover:bg-gray-700 disabled:bg-gray-500 disabled:cursor-not-allowed transition-colors focus:outline-none focus:ring-4 focus:ring-gray-400 focus:ring-opacity-50"
                    >
                        <DownloadIcon />
                        Download WAV
                    </button>
                )}
            </div>
        </div>
      </div>
       <footer className="text-center text-gray-600 mt-8 text-sm">
        <p>Powered by Bilal Mughal</p>
      </footer>
    </div>
  );
};

export default App;
