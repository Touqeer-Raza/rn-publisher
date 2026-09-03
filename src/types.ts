export type Platform = 'firebase' | 'play' | 'ios';

export type PlayTrackChoice = 'closed' | 'open' | 'production';

export interface PlayTrack {
  track: string;
  label: string;
  releaseStatus: 'completed' | 'draft';
}

export interface AvailabilityItem {
  available: boolean;
  enabled: boolean;
  reason?: string;
}

export interface Availability {
  firebase: AvailabilityItem;
  play: AvailabilityItem;
  ios: AvailabilityItem;
}

export interface PublishPlan {
  envName: string;
  platforms: Platform[];
  playTrack?: PlayTrack;
  notes: string;
  versionName: string;
  versionCode: number;
  skipConfirm: boolean;
  doCommit: boolean;
}
