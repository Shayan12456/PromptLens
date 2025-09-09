import { useState, useRef, useEffect } from "react";
import { Bot, Power, Video, Send, Sun, Moon, User } from "lucide-react";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import ReactMarkdown from "react-markdown";
import { GoogleGenAI } from "@google/genai";
import { startScreenRecording } from "./recordScreen";
import VADRunner from "./VadRunner"; // ⬅️ Separate component with VAD
import { v4 as uuidv4 } from "uuid";
import AnimatedText from './AnimatedText';

const apiKey = import.meta.env.VITE_GOOGLE_API_KEY;
const elevenLabsApiKey = import.meta.env.VITE_ELEVENLABS_API_KEY;
if (!apiKey) throw new Error("VITE_GOOGLE_API_KEY is not defined in .env");
if (!elevenLabsApiKey)
  throw new Error("VITE_ELEVENLABS_API_KEY is not defined in .env");
const elevenlabs = new ElevenLabsClient({ apiKey: elevenLabsApiKey });

const genAI = new GoogleGenAI({ apiKey });

type Message = {
  id: number;
  text: string;
  sender: "user" | "ai";
  videoBase?: string;
};

export default function App() {
  const [theme, setTheme] = useState('light');
  const [screenShareActive, setScreenShareActive] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 1,
      text: "How may I help you?",
      sender: "ai",
    },
  ]);
  const [inputValue, setInputValue] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<string | null>(null);

  // stream - telecast // VAD
  // recorder - record // query

  const micStreamRef = useRef<MediaStream | null>(null);
  const micStreamRecorderRef = useRef<MediaRecorder | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRecorderRef = useRef<MediaRecorder | null>(null);

  const screenChunksRef = useRef<Blob[]>([]); //Blob is a data object that holds raw binary data — like audio, video, images, or even plain text.
  const audioChunksRef = useRef<Blob[]>([]); //chunks = array of blobs (mini audio/video pieces)
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  let isAISpeaking = false; // Declare outside React component
  let vadDebounceTimer: NodeJS.Timeout | null = null;
  let speechStartTime = 0;

  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    if (newTheme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  };

  const debouncedSpeechEnd = () => {
    if (vadDebounceTimer) clearTimeout(vadDebounceTimer);
    vadDebounceTimer = setTimeout(() => {
      speechEnd();
    }, 400); // Wait 400ms before calling speechEnd
  };

  let speechStart = async () => {
    // ⛔️ Stop any ongoing AI audio immediately
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.src = "";
      currentAudioRef.current = null;
    }

    // if Audio Sharing is active so do Audio Recording
    if (micStreamRef.current) {
      // const audioRecorder = new MediaRecorder(micStreamRef.current); //mic access granted and saving audio in chunks
      const audioRecorder = new MediaRecorder(micStreamRef.current, {
        mimeType: "audio/webm;codecs=opus", // ✅ Browser-supported format
      });

      micStreamRecorderRef.current = audioRecorder;
      audioChunksRef.current = []; // Clear previous data
      audioRecorder.ondataavailable = (e) =>
        audioChunksRef.current.push(e.data);
      audioRecorder.start();
    }

    // if Screen Sharing is active so do Screen Recording
    if (screenStreamRef.current) {
      const screenRecorder = new MediaRecorder(screenStreamRef.current); //screen access granted and saving video in chunks
      screenStreamRecorderRef.current = screenRecorder; //saving in the recording from the sharing screen
      screenChunksRef.current = []; // Clear previous data
      screenRecorder.ondataavailable = (e) =>
        screenChunksRef.current.push(e.data);
      screenRecorder.start();
    }

    setIsListening(true);
    setStatus('listening');
  };

  let speechEnd = async () => {
    console.log("User stopped speaking");
    const elapsed = Date.now() - speechStartTime;
    if (elapsed < 600) {
      const delay = 600 - elapsed;
      console.log(`Delaying speechEnd by ${delay}ms for valid recording`);
      await new Promise((res) => setTimeout(res, delay));
    }
    micStreamRecorderRef.current?.stop(); //audio recorder stopped not audio sharing
    screenStreamRecorderRef.current?.stop(); //video recorder stopped not screen sharing
    await new Promise((res) => setTimeout(res, 300)); // <-- Add this here
    setIsListening(false);
    setStatus('processing');
    // Add placeholder user message
    const userPlaceholderId = Date.now() + Math.floor(Math.random() * 1000000);
    setMessages((prev) => [
      ...prev,
      {
        id: userPlaceholderId,
        text: '',
        sender: 'user',
      },
    ]);
    (async () => {
      const audioBlob = new Blob(audioChunksRef.current, {
        //merge all the chunks into one final Blob
        type: "audio/webm", //audio chunk ot blob
      });
      if (!audioBlob || audioBlob.size === 0) {
        console.warn("Audio blob is empty. Skipping transcription.");
        // Remove placeholder
        setMessages((prev) => prev.filter((msg) => msg.id !== userPlaceholderId));
        setStatus(null);
        return null;
      }
      const screenBlob = new Blob(screenChunksRef.current, {
        type: "video/webm", //video chunk to bolb
      });
      if (!screenBlob || screenBlob.size === 0) {
        console.warn("Screen blob is empty. Skipping Screen Recording.");
        // Remove placeholder
        setMessages((prev) => prev.filter((msg) => msg.id !== userPlaceholderId));
        setStatus(null);
        return null;
      }
      const audioBase64 = await blobToBase64(audioBlob); //blob to Gemini favourable format
      const videoBase64 = await blobToBase64(screenBlob); //blob to Gemini favourable format
      const userAudioAndResponse =
        (await handleQuery(audioBase64, videoBase64)) || ""; //via elevenlabs
      console.log(userAudioAndResponse);
      if (userAudioAndResponse.includes("QZOP")) {
        // Remove placeholder
        setMessages((prev) => prev.filter((msg) => msg.id !== userPlaceholderId));
        setStatus(null);
        return;
      }
      // Match everything after "result:" until the next key or end
      const responseMatch = userAudioAndResponse.match(/result:\s*([^]+?)\s*transcript:/i);
      const transcriptMatch = userAudioAndResponse.match(/transcript:\s*([^]+)/i);
      let result = responseMatch?.[1]?.trim() || null;
      if (result) {
        result = result.replace(/[,\\s]+$/, ''); // Remove trailing commas and whitespace
      }
      const transcript = transcriptMatch?.[1]?.trim() || null;
      if (transcript && result) {
        // Replace placeholder with real user message
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === userPlaceholderId
              ? { ...msg, text: transcript, videoBase: videoBase64 }
              : msg
          ).concat({
            id: Date.now() + 1 * Math.floor(Math.random() * 1000000),
            text: result,
            sender: "ai",
          })
        );
        setStatus(null);
        // 👇 Call audio response function (AI speaks)
        await playFullResponseAudio(result);
      } else {
        // Remove placeholder and add error
        setMessages((prev) => [
          ...prev.filter((msg) => msg.id !== userPlaceholderId),
          {
            id: Date.now(),
            text: result || "Sorry, I couldn't understand that.",
            sender: "ai",
          },
        ]);
        setStatus(null);
      }
    })();
  };2

  async function playFullResponseAudio(result: string) {
    try {
      // Abort any currently playing audio
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current.src = "";
        currentAudioRef.current = null;
      }

      let formattedResult = result
        .replace(/[*_`~^]/g, "")
        .replace(/[^\u0000-\u007F]/g, "");

      const stream = await elevenlabs.textToSpeech.stream(
        "JBFqnCBsd6RMkjVDRZzb",
        {
          text: formattedResult,
          modelId: "eleven_monolingual_v1",
          outputFormat: "mp3_44100_128",
        }
      );

      const blob = await new Response(stream).blob();
      const audioUrl = URL.createObjectURL(blob);
      const audio = new Audio(audioUrl);

      currentAudioRef.current = audio;

      audio.onended = () => {
        console.log("AI response playback finished.");
      };

      await audio.play();
    } catch (err) {
      console.error("Error playing full response audio:", err);
    }
  }

  function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
  }

  const handleShareScreen = async () => {
    try {
      const stream = await startScreenRecording();
      screenStreamRef.current = stream;
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = micStream;
      setScreenShareActive(true);
    } catch (e) {
      console.error("Failed to get screen share permission:", e);
    }
  };

  const handleStopScreenShare = () => {
    // Stop all tracks for screen and mic
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(track => track.stop());
      screenStreamRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(track => track.stop());
      micStreamRef.current = null;
    }
    setScreenShareActive(false);
  };

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const sendQueryToAI = async (text: string) => {
    setStatus('thinking');
    // Add placeholder AI message
    const aiPlaceholderId = Date.now() + Math.floor(Math.random() * 1000000);
    setMessages((prev) => [
      ...prev,
      {
        id: aiPlaceholderId,
        text: '',
        sender: 'ai',
      },
    ]);
    try {
      // 2️⃣👇 Build shared chat history
      const historyMessages = messages.map((msg) => ({
        role: msg.sender === "user" ? "user" : "model",
        parts: [{ text: msg.text }],
      }));

      const result = await genAI.models.generateContent({
        model: "gemini-2.0-flash-001",
        contents: [
          ...historyMessages, // 🧠 Prior messages for context
          {
            role: "user",
            parts: [
              {
                text, // 👈 The current user-typed message
              },
            ],
          },
        ],
        config: {
          systemInstruction: `
You are a helpful and intelligent assistant in a chat-based interface.

Your responsibilities:
- Respond to user chat messages based on prior conversation.
- You do NOT have access to video, audio, or screen context.
- Keep replies short, smart, and natural.
- Avoid repeating previous replies.
- If unclear, ask follow-up questions instead of apologizing.

Act like a helpful coworker — direct, warm, and confident.
`,
        },
      });

      // Replace placeholder with real AI message
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === aiPlaceholderId
            ? { ...msg, text: result.text || "Thinking..." }
            : msg
        )
      );
      setStatus(null);
      await playFullResponseAudio(result.text || "Thinking...");
    } catch (err) {
      // Remove placeholder and add error
      setMessages((prev) => [
        ...prev.filter((msg) => msg.id !== aiPlaceholderId),
        {
          id: Date.now() - Math.floor(Math.random() * 1000000),
          text: "Error reaching Gemini API.",
          sender: "ai",
        },
      ]);
      setStatus(null);
    }
  };

  const handleSendMessage = async () => {
    const finalText = inputValue.trim();
    if (finalText === "") return;

    const userMessage: Message = {
      id: Date.now() - Math.floor(Math.random() * 1000000),
      text: finalText,
      sender: "user",
    };
    setMessages((prev) => [...prev, userMessage]);
    setInputValue("");
    setStatus('thinking');
    await sendQueryToAI(finalText);
  };

  const handleQuery = async (audioBase64: string, videoBase64: string) => {
    setStatus('processing');
    try {
      // 2️⃣👇 Build shared chat history
      const historyMessages = messages.map((msg) => ({
        role: msg.sender === "user" ? "user" : "model",
        parts: [{ text: msg.text }],
      }));

      const verify = await genAI.models.generateContent({
        model: "gemini-2.0-flash-001",
        contents: [
          ...historyMessages,
          {
            role: "user",
            parts: [
              {
                text: `
                You are a real-time voice assistant with screen awareness.

1. First, transcribe the audio input (English only).
2. Then check: is it valid human speech in English?
   - Accept short but meaningful English phrases like "hi", "look", etc.
   - Reject background noise, gibberish, or non-English phrases.
3. Do NOT check grammar or sentence structure.


5. If the input is valid:
   - Use the screen video **only if it helps**. Otherwise, answer using your own knowledge as a smart assistant.
   - Respond naturally like a voice assistant, in a direct and friendly tone.
   - Always assist the user even if it is not related to the screen content or somehting out of the box.
   - Output in **this exact format**:
     result: <your response to user>,
     transcript: <user's words>

7. DO NOT explain your limitations.
8. DO NOT prefix with "based on the screen..." or similar.
9. Keep consistency in your responses like you did earlier.

`,
              },
              {
                inlineData: {
                  mimeType: "audio/webm",
                  data: audioBase64.replace(/^data:audio\/webm;base64,/, ""),
                },
              },
              {
                text: "Here is the screen context to support understanding:",
              },
              {
                inlineData: {
                  mimeType: "video/webm",
                  data: videoBase64.replace(/^data:video\/webm;base64,/, ""),
                },
              },
            ],
          },
        ],
        config: {
          systemInstruction: `
              You are an intelligent voice assistant inside a screen-aware application.

              Your job:
              → First, verify that the input is valid human-spoken English.  
              → If valid: transcribe and respond with helpful output using screen video as context.  

              You must catch cases like "hu", "uh", "hmm" as **invalid** — do not treat them as valid English sentences.

              Be direct, short, and conversational. No filler or over-explanation.
              `,
        },
      });

      return verify.text; // ✅ Valid transcript
    } catch (error) {
      console.error("Error during transcription:", error);
      const errorMessage: Message = {
        id: Date.now() - Math.floor(Math.random() * 1000000),
        text: "Sorry, I had trouble understanding that.",
        sender: "ai",
      };
      setMessages((prev) => [...prev, errorMessage]);
      setStatus(null);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-black text-black dark:text-white font-sans">
      <header className="flex justify-between items-center p-4 border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
        <div className="flex items-center gap-2">
          {/* <Bot className="w-8 h-8 text-purple-400" /> */}
          <h1 className="text-xl font-bold">PromptLens</h1>
        </div>
        <div className="flex items-center gap-4">
        <button onClick={toggleTheme} className="p-2 rounded-full focus:outline-none">
          {theme === 'light' ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
        </button>
        {!screenShareActive && (
          <button
            onClick={handleShareScreen}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm bg-black text-white dark:bg-white dark:text-black hover:bg-gray-800 dark:hover:bg-gray-200"
          >
            <Video className="w-4 h-4" />
            <span>Share Screen</span>
          </button>
        )}
        {screenShareActive && (
          <button
            onClick={handleStopScreenShare}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm bg-red-600 hover:bg-red-700"
          >
            <Power className="w-4 h-4" />
            <span>Stop Sharing</span>
          </button>
        )}
        </div>
      </header>

      <main className="relative flex-1 flex flex-col p-4 overflow-hidden">
        {/* ✅ Inject VAD component only when screen sharing is active */}
        {screenShareActive && (
          <VADRunner
            onSpeechStart={speechStart}
            onSpeechEnd={debouncedSpeechEnd}
          />
        )}

        <div className="flex-1 overflow-y-auto space-y-6 pr-4 pb-4 pt-10">
          {messages.map((message, idx) => {
            const isLast = idx === messages.length - 1;
            // Show status in AI bubble if thinking/generating (chat mode)
            const showInAIBubble =
              isLast &&
              message.sender === "ai" &&
              status &&
              [ "thinking", "generating"].includes(status);
            // Show status in user bubble if listening/processing (voice mode)
            const showInUserBubble =
              isLast &&
              message.sender === "user" &&
              status &&
              [ "listening", "processing"].includes(status);
            return (
              <div
                key={message.id}
                className={`flex items-start gap-4 ${
                  message.sender === "user" ? "justify-end" : "justify-start"
                }`}
              >
                {message.sender === "ai" && (
                  <div className="w-8 h-8 bg-white text-black rounded-full flex-shrink-0 flex items-center justify-center">
                    <Bot size={20} />
                  </div>
                )}
                <div
                  className={`p-4 rounded-2xl max-w-xl shadow-md transition-all duration-300 ${
                    message.sender === "ai"
                      ? "bg-white dark:bg-black border border-gray-200 dark:border-gray-700 text-black dark:text-white"
                      : "bg-gray-200 text-black dark:bg-gray-700 dark:text-white"
                  }`}
                >
                  {message.sender === "user" && message.videoBase && (
                    <video
                      src={message.videoBase}
                      controls
                      className="w-full rounded-md mb-2"
                    />
                  )}

                  <div className="prose dark:prose-invert max-w-none">
                    <style>
                      {`
            ol {
              list-style-type: decimal !important;
              margin-left: 1.5rem !important;
            }

            ul {
              list-style-type: disc !important;
              margin-left: 1.5rem !important;
            }

            li {
              margin-bottom: 0.25rem;
            }
          `}
                    </style>
                    <ReactMarkdown>{message.text}</ReactMarkdown>
                  </div>
                  {/* Status animation in correct bubble */}
                  {showInAIBubble && <AnimatedText event={status} />}
                  {showInUserBubble && <AnimatedText event={status} />}
                </div>
                {message.sender === "user" && (
                  <div className="w-8 h-8 bg-gray-200 dark:bg-gray-700 text-black dark:text-white rounded-full flex-shrink-0 flex items-center justify-center">
                    <User className="w-5 h-5" />
                  </div>
                )}
              </div>
            );
          })}
          <div ref={chatEndRef} />
        </div>

        <div className="w-full max-w-3xl mx-auto flex-shrink-0 pt-4">
          <div className="relative">
            <div className="absolute left-3 top-1/2 -translate-y-1/2 flex gap-2">
              {/* <button
                onClick={handleToggleRecording}
                className={`p-2 rounded-full transition-colors ${isListening
                    ? "bg-red-500 animate-pulse"
                    : "bg-blue-600 hover:bg-blue-700"
                }`}
              >
                <Mic size={20} />
              </button> */}
              {/* <button className="p-2 bg-gray-700 rounded-full hover:bg-gray-600">
                <Video size={20} />
              </button> */}
            </div>
            <input
              type="text"
              placeholder="Start typing a prompt..."
              className="w-full bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-full py-4 pl-12 pr-32 text-lg text-black dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-white-500 focus:ring-offset-2 dark:focus:ring-offset-black shadow-md transition-all duration-300"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSendMessage();
              }}
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-2">
              {/* <button className="p-2 bg-gray-700 rounded-full hover:bg-gray-600">
                <Plus size={20} />
              </button> */}
              <button
                onClick={handleSendMessage}
                className="px-4 py-2 bg-gray-200 dark:bg-gray-700 rounded-full text-sm font-semibold flex items-center gap-1 hover:bg-gray-300 dark:hover:bg-gray-600"
              >
                 <Send size={14} />
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
