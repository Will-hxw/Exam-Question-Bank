import { join } from 'node:path'

const config = {
  plugins: {
    [join(process.cwd(), 'postcss-unocss.cjs')]: {},
  },
}

export default config
