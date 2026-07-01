/* Optional authored graphics asset slots.
 * Empty URLs are intentional: they reserve stable keys without causing runtime
 * requests. Fill in URLs as assets are authored and optimized.
 */
'use strict';

export const ASSET_MANIFEST = {
  version: 1,
  models: [
    {
      key: 'venue-shared',
      label: 'Shared venue props',
      url: '',
      scope: 'venue',
      optional: true
    },
    {
      key: 'venue-park',
      label: 'Park venue props',
      url: '/assets/models/venues/park-props.glb',
      scope: 'venue',
      venue: 'park',
      optional: true
    },
    {
      key: 'venue-tropical',
      label: 'Tropical venue props',
      url: '/assets/models/venues/tropical-props.glb',
      scope: 'venue',
      venue: 'tropical',
      optional: true
    },
    {
      key: 'venue-indoor',
      label: 'Indoor venue props',
      url: '/assets/models/venues/indoor-props.glb',
      scope: 'venue',
      venue: 'indoor',
      optional: true
    },
    {
      key: 'player-base',
      label: 'Player model prototype',
      url: '',
      scope: 'player',
      playerScale: 1,
      playerOffset: [0, 0, 0],
      playerRotation: [0, 0, 0],
      optional: true
    }
  ],
  textures: [
    {
      key: 'court-blue-albedo',
      label: 'Blue court albedo',
      url: '',
      scope: 'court',
      optional: true
    },
    {
      key: 'court-green-albedo',
      label: 'Green court albedo',
      url: '',
      scope: 'court',
      optional: true
    }
  ],
  environments: [
    {
      key: 'outdoor-day-env',
      label: 'Outdoor day environment',
      url: '',
      scope: 'environment',
      optional: true
    },
    {
      key: 'outdoor-night-env',
      label: 'Outdoor night environment',
      url: '',
      scope: 'environment',
      optional: true
    },
    {
      key: 'indoor-env',
      label: 'Indoor environment',
      url: '',
      scope: 'environment',
      optional: true
    }
  ],
  animations: [
    {
      key: 'player-idle',
      label: 'Player idle animation',
      url: '',
      scope: 'player-animation',
      optional: true
    },
    {
      key: 'player-run',
      label: 'Player run animation',
      url: '',
      scope: 'player-animation',
      optional: true
    },
    {
      key: 'player-forehand',
      label: 'Player forehand animation',
      url: '',
      scope: 'player-animation',
      optional: true
    },
    {
      key: 'player-backhand',
      label: 'Player backhand animation',
      url: '',
      scope: 'player-animation',
      optional: true
    }
  ]
};
