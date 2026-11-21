import DefaultTheme from 'vitepress/theme'
import './custom.css'
import { h } from 'vue'

export default {
  extends: DefaultTheme,
  Layout: () => {
    return h(DefaultTheme.Layout, null, {
      'home-features-after': () => h('div', { class: 'custom-home-footer' }, [
        h('p', { class: 'disclaimer' }, 'LamaranKilat bukan agen lowongan. Kami hanya bantu buat CV & surat lamaran yang lolos filter ATS.')
      ]),
    })
  },
  enhanceApp({ app }) {
    // register global components if needed
  },
}
