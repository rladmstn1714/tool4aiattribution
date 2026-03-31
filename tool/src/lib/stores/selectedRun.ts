import { writable } from 'svelte/store';

/** When VITE_DATA_BASE points to a high-level folder with run subfolders, this holds the selected run name. */
export const selectedRun = writable<string | null>(null);
