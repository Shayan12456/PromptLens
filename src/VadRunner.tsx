import { useMicVAD } from "@ricky0123/vad-react";
import { useEffect } from "react";

export default function VadRunner({
  onSpeechStart,
  onSpeechEnd,
  onSpeakingChange, // renamed for clarity
}: {
  onSpeechStart: () => void;
  onSpeechEnd: () => void;
  onSpeakingChange?: (speaking: boolean) => void;
}) {
  const {
    userSpeaking,    
  } = useMicVAD({
    startOnLoad: true,
    onSpeechStart,
    onSpeechEnd,
  });

  useEffect(() => {
    if (onSpeakingChange) onSpeakingChange(userSpeaking);
  }, [userSpeaking]);

  return null;
}
