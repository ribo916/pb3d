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
    },
    {
      key: 'player-human-v1',
      label: 'Player 1 authored human model',
      url: '/assets/models/players/player-human-v1.glb',
      scope: 'player',
      fallbackKey: 'player-poc',
      playerScale: 1,
      playerOffset: [0, 0, 0],
      playerRotation: [0, 0, 0],
      paddleSocketOffset: [0, 0, 0],
      paddleSocketRotation: [Math.PI, 0, 0],
      swingClipOverrides: { serve: 'fh' },
      syncPrimitiveArms: false,
      optional: true
    },
    {
      key: 'player-partner-v1',
      label: 'Partner authored human model',
      url: '/assets/models/players/player-partner-v1.glb',
      scope: 'player',
      fallbackKey: 'player-poc',
      playerScale: 1,
      playerOffset: [0, 0, 0],
      playerRotation: [0, 0, 0],
      paddleSocketOffset: [0, 0, 0],
      paddleSocketRotation: [Math.PI, 0, 0],
      swingClipOverrides: { serve: 'fh' },
      syncPrimitiveArms: false,
      optional: true
    },
    {
      key: 'player-poc',
      label: 'Human player visual POC',
      url: '/assets/models/players/player-poc.glb',
      scope: 'player',
      playerScale: 1,
      playerOffset: [0, 0, 0],
      playerRotation: [0, 0, 0],
      paddleSocketOffset: [0, 0, 0],
      syncPrimitiveArms: true,
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
      key: 'player-ready',
      label: 'Player ready stance animation',
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
    },
    {
      key: 'player-serve',
      label: 'Player serve animation',
      url: '',
      scope: 'player-animation',
      optional: true
    },
    {
      key: 'player-smash',
      label: 'Player smash animation',
      url: '',
      scope: 'player-animation',
      optional: true
    }
  ]
};
