import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, Modality } from '@google/genai';
import { SpeakerWaveIcon, LoadingSpinnerIcon } from './components/Icons';

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
function audioBufferToWav(buffer: AudioBuffer): Blob {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const format = 1; // PCM
    const bitDepth = 16;

    const channelData = buffer.getChannelData(0);
    const pcmData = new Int16Array(channelData.length);
    for (let i = 0; i < channelData.length; i++) {
        pcmData[i] = Math.max(-1, Math.min(1, channelData[i])) * 32767;
    }

    const dataLength = pcmData.length * (bitDepth / 8);
    const bufferLength = 44 + dataLength;
    const wavBuffer = new ArrayBuffer(bufferLength);
    const view = new DataView(wavBuffer);

    function writeString(offset: number, str: string) {
        for (let i = 0; i < str.length; i++) {
            view.setUint8(offset + i, str.charCodeAt(i));
        }
    }

    // RIFF header
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataLength, true);
    writeString(8, 'WAVE');

    // fmt sub-chunk
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true); // Subchunk1Size
    view.setUint16(20, format, true); // AudioFormat
    view.setUint16(22, numChannels, true); // NumChannels
    view.setUint32(24, sampleRate, true); // SampleRate
    view.setUint32(28, sampleRate * numChannels * (bitDepth / 8), true); // ByteRate
    view.setUint16(32, numChannels * (bitDepth / 8), true); // BlockAlign
    view.setUint16(34, bitDepth, true); // BitsPerSample

    // data sub-chunk
    writeString(36, 'data');
    view.setUint32(40, dataLength, true);

    // Write PCM data
    for (let i = 0; i < pcmData.length; i++) {
        view.setInt16(44 + i * 2, pcmData[i], true);
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

const App: React.FC = () => {
  const [text, setText] = useState('');
  const [selectedVoice, setSelectedVoice] = useState(voices[0].id);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);

  // Effect to clean up the object URL to prevent memory leaks
  useEffect(() => {
    return () => {
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
    };
  }, [audioUrl]);

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
    setAudioUrl(null); // Clear previous audio

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const prompt = text;

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
        
        // Play the audio automatically once
        const source = outputAudioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(outputAudioContext.destination);
        source.start();

        // Create a WAV blob and object URL for the audio player
        const wavBlob = audioBufferToWav(buffer);
        const url = URL.createObjectURL(wavBlob);
        setAudioUrl(url);

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


  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 font-sans p-4">
      <div className="w-full max-w-2xl bg-gray-800 rounded-2xl shadow-2xl p-6 md:p-8 space-y-6 border border-gray-700">
        <header className="text-center">
          <h1 className="text-3xl md:text-4xl font-bold text-cyan-400">Text-to-Speech Generator</h1>
          <p className="text-gray-400 mt-2">Convert your text into lifelike speech.</p>
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

            <div className="pt-2">
                <button
                    onClick={handleGenerateSpeech}
                    disabled={isLoading || !text.trim()}
                    className="w-full flex items-center justify-center gap-2 px-6 py-2.5 bg-cyan-500 text-white font-semibold rounded-lg hover:bg-cyan-600 disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors focus:outline-none focus:ring-4 focus:ring-cyan-300 focus:ring-opacity-50"
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
            </div>
            {audioUrl && !isLoading && (
                 <div className="pt-4">
                    <h3 className="text-lg font-semibold text-gray-300 mb-2">Playback</h3>
                    <audio controls src={audioUrl} className="w-full rounded-lg" aria-label="Generated speech playback">
                        Your browser does not support the audio element.
                    </audio>
                </div>
            )}
        </div>
      </div>
       <footer className="text-center text-gray-600 mt-8 text-sm">
        <p>Powered by Bilal Mughal</p>
      </footer>
    </div>
  );
};

export default App;