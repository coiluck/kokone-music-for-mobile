export interface AudioMeta {
    id: number;
    displayPath: string;
    displayName: string;
    title: string;
    artist: string;
    album: string;
    durationMs: number;
    sizeBytes: number;
}
export declare function hasAudioPermission(): Promise<boolean>;
/**
 * Prompts the user for audio read permission. The returned promise resolves
 * after the user has accepted or denied the request — no polling needed.
 */
export declare function requestAudioPermission(): Promise<boolean>;
export declare function queryAudioMetadata(): Promise<AudioMeta[]>;
export declare function audioHash(audioId: number, isMp3: boolean): Promise<string>;
