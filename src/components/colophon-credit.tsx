import { siteConfig } from '@/config/site'

export function ColophonCredit() {
  return (
    <a className="group colophon-link" href={`mailto:${siteConfig.codeAuthor.email}`} lang="en">
      <span className="colophon-title">{siteConfig.designCreditPrefix}</span>
      <span className="colophon-email">{siteConfig.codeAuthor.email}</span>
    </a>
  )
}
