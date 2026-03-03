import { useEffect, useRef } from "react";
import { ClaudeLogo } from "./ClaudeLogo";

interface Props {
  speaking: boolean;
  recording: boolean;
  currentSpeaker: string | null;
  currentText: string | null;
  sentenceIndex: number;
  sentenceCount: number;
  enabled: boolean;
  ttsReady: boolean;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onToggleVoice: () => void;
  onInitAudio: () => void;
}

export function VoiceBar({
  speaking,
  recording,
  currentSpeaker,
  currentText,
  sentenceIndex,
  sentenceCount,
  enabled,
  ttsReady,
  onStartRecording,
  onStopRecording,
  onToggleVoice,
  onInitAudio,
}: Props) {
  const hasInitRef = useRef(false);

  // Init audio on first click anywhere
  useEffect(() => {
    if (hasInitRef.current) return;
    const handler = () => {
      onInitAudio();
      hasInitRef.current = true;
      document.removeEventListener("click", handler);
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [onInitAudio]);

  const handleMicClick = () => {
    if (recording) {
      onStopRecording();
    } else {
      onInitAudio();
      onStartRecording();
    }
  };

  return (
    <div className="voice-bar">
      {/* Claude Code logo */}
      <ClaudeLogo size={20} className="voice-bar-logo" />

      {/* Mic button */}
      <button
        className={`voice-mic ${recording ? "active" : ""}`}
        onMouseDown={handleMicClick}
        title={recording ? "Release to send" : "Hold to speak"}
      >
        <span className="mic-icon">{recording ? "◉" : "◎"}</span>
      </button>

      {/* Status area */}
      <div className="voice-status">
        {recording && (
          <div className="voice-recording">
            <span className="voice-recording-dot" />
            <span className="voice-recording-text">
              {currentText || "Listening..."}
            </span>
          </div>
        )}

        {speaking && !recording && (
          <div className="voice-speaking">
            <div className="voice-waveform">
              {[...Array(5)].map((_, i) => (
                <span key={i} className="wave-bar" style={{ animationDelay: `${i * 0.1}s` }} />
              ))}
            </div>
            <div className="voice-speaker-info">
              <span className="voice-speaker-name">{currentSpeaker}</span>
              {sentenceCount > 1 && (
                <span className="voice-progress">
                  {sentenceIndex}/{sentenceCount}
                </span>
              )}
            </div>
            {currentText && (
              <div className="voice-transcript">{currentText}</div>
            )}
          </div>
        )}

        {!speaking && !recording && (
          <div className="voice-idle">
            {enabled ? (ttsReady ? "Voice ready" : "Loading TTS...") : "Voice off"}
          </div>
        )}
      </div>

      {/* Toggle */}
      <button
        className={`voice-toggle ${enabled ? "on" : "off"}`}
        onClick={onToggleVoice}
        title={enabled ? "Disable voice" : "Enable voice"}
      >
        {enabled ? "🔊" : "🔇"}
      </button>
    </div>
  );
}
