#!/usr/bin/env node

const Octokit = require('@octokit/rest').plugin(require('@octokit/plugin-throttling'))

const opts = {
  throttle: {
    onRateLimit: (retryAfter, options) => {
      octokit.log.warn(`Request quota exhausted for request ${options.method} ${options.url}`)
      console.log(`Retrying after ${retryAfter} seconds!`)
      return true
    },
    onAbuseLimit: (retryAfter, options) => {
      octokit.log.warn(`Abuse detected for request ${options.method} ${options.url}`)
      console.log(`Retrying after ${retryAfter} seconds!`)
      return true
    }
  }
}

const token = process.env.PR_CHANGES_TOKEN
if ( token ) {
  opts.auth = token
} else {
  console.error('This needs PR_CHANGES_TOKEN to work, exiting now..')
  process.exit(-1)
}

const octokit = new Octokit(opts)


const argv = require('minimist')(process.argv.slice(2))

const repo = argv['repository']
const owner = argv['owner']
const updateAll = argv['update-all']
const npmBaseUrl = argv['npm-base-url']

async function main() {

  try
  {
    const tags = await octokit.repos.listTags({owner, repo, per_page:!updateAll ? 10 : 100, pages:1 })

    if ( tags.data.length == 0 ) {
      console.error('no tags found')
      process.exit(-1)
    }

    if ( tags.data[0].name.includes('beta') ) {
      console.log('Not creating release notes for a beta')
      process.exit(0)
    }

    let prev = tags.data[0].name
    for ( let i = 1; i < tags.data.length; i++ ) {
      const tag = tags.data[i]
      if ( !tag.name.includes('beta') && tag.name != 'latest' ) {
        console.log(`compare base: ${tag.name} head: ${prev}`)
        //const commits = { data: { commits: [] } }
        const commits = await octokit.repos.compareCommits({owner, repo, base:tag.name, head:prev})

        const donePRs = []
        let body = ''
        for ( let j = 0; j < commits.data.commits.length; j++ ) {
          const commit = commits.data.commits[j]
          const prs = await octokit.search.issuesAndPullRequests({ q: `type:pr repo:${owner}/${repo} is:merged ${commit.sha}` })
          if ( prs.data.items.length > 0 ) {
            const pr = prs.data.items[0]
            if ( donePRs.indexOf(pr.number) == -1 ) {
              donePRs.push(pr.number)
              body += `+ [#${pr.number}](${pr.pull_request.html_url}) ${pr.title} (@${pr.user.login})\n`
            }
          }
        }

        const baseUrl = npmBaseUrl ? npmBaseUrl : `https://www.npmjs.com/package/@${owner}/${repo}`
        body += `\n\n[This version in npm](${baseUrl}/v/${prev.slice(1)})`
        try {
          await octokit.repos.createRelease({owner, repo, tag_name: prev, body:body})
        } catch ( e ) {
          const release = await octokit.repos.getReleaseByTag({owner, repo, tag:prev})
          await octokit.repos.updateRelease({owner, repo, release_id: release.data.id, prev, body:body})
        }
        console.log(`created or updated ${prev}`)
        prev = tag.name
        if ( !updateAll ) {
          break
        }
      }
    }
  } catch ( e ) {
    console.error(e)
    process.exit(1)
  }
}

main()



