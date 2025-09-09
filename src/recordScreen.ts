let mediaRecorder: MediaRecorder;
let recordedChunks: Blob[] = [];
let screenStream: MediaStream;

export async function takeScreenshot(screenStream: any): Promise<string | null> {
  if (!screenStream) {
    console.warn("No active screen stream");
    return null;
  }

  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.srcObject = screenStream;

    video.onloadedmetadata = () => {
      video.play();

      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      const ctx = canvas.getContext("2d");
      ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);

      const dataUrl = canvas.toDataURL("image/png");
      resolve(dataUrl);
    };
  });
}



export async function startScreenRecording(): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: false,
  });
  screenStream = stream;

  recordedChunks = [];

  mediaRecorder = new MediaRecorder(stream, {
    mimeType: "video/webm; codecs=vp9",
  });

  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      recordedChunks.push(event.data);
    }
  };

  mediaRecorder.start();
  console.log("Recording started...");
  return stream;
}

export function stopScreenRecording(): Promise<string> {
  return new Promise((resolve) => {
    if (mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder.onstop = async () => {
        screenStream?.getTracks().forEach((track) => track.stop());
        const blob = new Blob(recordedChunks, { type: "video/webm" });
        if (blob.size > 0) {
          const base64 = await blobToBase64(blob);
          const dataUri = `data:video/webm;base64,${base64}`;
          resolve(dataUri);
        } else {
          console.warn("Screen recording was empty.");
          resolve("");
        }
      };
      mediaRecorder.stop();
    } else {
      console.warn("Screen recorder was not active when stop was called.");
      resolve("");
    }
  });
}

export const discardScreenRecording = () => {
  if (mediaRecorder && mediaRecorder.state === "recording") {
    mediaRecorder.stream.getTracks().forEach((track) => track.stop());
    mediaRecorder.onstop = null; // Don't process chunks
    mediaRecorder.stop();
    recordedChunks = [];
  }
};

// Helper to convert blob to base64
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(",")[1]; // remove `data:video/webm;base64,`
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}