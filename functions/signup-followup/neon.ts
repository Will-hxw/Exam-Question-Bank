import { defineConfig } from '@neon/config/v1'

export default defineConfig({
  functions: {
    signupfollowup: {
      name: 'Exam Question Bank signup follow-up',
      source: './index.mjs',
      env: {
        EQB_FOLLOWUP_SCHEDULER_TOKEN: {
          value: process.env.EQB_FOLLOWUP_SCHEDULER_TOKEN,
          required: true,
        },
      },
    },
  },
  triggers: {
    'signup-followup-even-hours': {
      type: 'schedule',
      function: 'signupfollowup',
      cron: '0 */2 * * *',
    },
  },
})
