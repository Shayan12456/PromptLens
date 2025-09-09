import React from 'react';
import './AnimatedText.css';

interface AnimatedTextProps {
  event: 'idle' | 'recording' | 'generating' | 'listening' | 'processing' | 'thinking' | string;
}

const AnimatedText: React.FC<AnimatedTextProps> = ({ event }) => {
  if (event === 'recording' || event === 'listening') {
    return (
      <div className="animated-text pulse">
        <span className="dot red"></span> Listening…
      </div>
    );
  }
  if (event === 'processing') {
    return (
      <div className="animated-text">
        <span className="dot"></span> Processing…
      </div>
    );
  }
  if (event === 'generating' || event === 'thinking') {
    return (
      <div className="animated-text">
        Thinking<span className="dots"><span>.</span><span>.</span><span>.</span></span>
      </div>
    );
  }
  return null;
};

export default AnimatedText; 