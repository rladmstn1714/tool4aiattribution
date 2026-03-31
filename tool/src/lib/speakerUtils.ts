/**
 * Utterance / action speaker ids.
 * - Canonical 1:1 chat: "user" | "assistant"
 * - Slack exports: display names (e.g. "Eunsu", "Minsik Jeon") — treat as human side unless "assistant".
 */

export function isAssistantSpeakerId(speaker: string | undefined | null): boolean {
	return speaker === 'assistant';
}

/** Human side: "user", any Slack display name, or unknown (defaults away from assistant). */
export function isUserSideUtterance(speaker: string | undefined | null): boolean {
	return !isAssistantSpeakerId(speaker);
}

export function utteranceDisplayName(speaker: string): string {
	if (speaker === 'user') return 'You';
	if (speaker === 'assistant') return 'Assistant';
	return speaker;
}

export function utteranceAvatarInitial(speaker: string): string {
	if (speaker === 'user') return 'U';
	if (speaker === 'assistant') return 'AI';
	const t = speaker.trim();
	if (!t) return '?';
	const first = [...t][0];
	return first ? first.toUpperCase() : '?';
}

/** Action cards / lists: "User" and "Assistant" for canonical roles; otherwise show Slack-style names. */
export function actionSpeakerLabel(speaker: string): string {
	if (speaker === 'user') return 'User';
	if (speaker === 'assistant') return 'Assistant';
	return speaker;
}
