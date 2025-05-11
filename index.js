const { Client, GatewayIntentBits } = require("discord.js");
const express = require("express");
const crypto = require("crypto");
require("dotenv").config();

const app = express();

const FORUM_CHANNEL_ID = process.env.FORUM_CHANNEL_ID;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

const discord = new Client({
  intents: [GatewayIntentBits.Guilds],
});

discord.once("ready", () => {
  console.log(`Bot logged in as ${discord.user.tag}`);
});

// Middleware to capture raw body
app.use("/webhook", express.raw({ type: "application/json" }));

function verifyWebhookSignature(payload, signature) {
  const expectedSignature =
    "sha256=" +
    crypto.createHmac("sha256", WEBHOOK_SECRET).update(payload).digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

async function findThreadByIssueNumber(issueNumber) {
  const forum = await discord.channels.fetch(FORUM_CHANNEL_ID);
  const threads = await forum.threads.fetchActive();

  const threadName = `#${issueNumber} -`;
  const thread = threads.threads.find((t) => t.name.startsWith(threadName));

  if (!thread) {
    const archivedThreads = await forum.threads.fetchArchived();
    return archivedThreads.threads.find((t) => t.name.startsWith(threadName));
  }

  return thread;
}

app.post("/webhook", async (req, res) => {
  try {
    // Verify webhook signature
    const signature = req.headers["x-hub-signature-256"];
    if (!signature || !verifyWebhookSignature(req.body, signature)) {
      console.log("Invalid webhook signature");
      return res.sendStatus(401);
    }

    // Parse the verified payload
    const payload = JSON.parse(req.body.toString());
    const { action, issue, pull_request, comment, sender } = payload;

    // Handle new issues (not PRs)
    if (action === "opened" && issue && !pull_request) {
      const forum = await discord.channels.fetch(FORUM_CHANNEL_ID);

      await forum.threads.create({
        name: `#${issue.number} - ${issue.title}`,
        message: {
          content: `**New Issue by ${sender.login}:** <${issue.html_url}>\n\n${
            issue.body || "No description"
          }`,
        },
      });

      console.log(`Created thread for issue #${issue.number}`);
    }

    // Handle new PRs
    else if (action === "opened" && pull_request) {
      // Check if thread already exists (from an issue)
      let thread = await findThreadByIssueNumber(pull_request.number);

      if (thread) {
        // Issue already exists, just notify about the PR
        await thread.send(
          `**${sender.login} opened a pull request:** <${
            pull_request.html_url
          }>\n\n${pull_request.body || "No description"}`
        );
      } else {
        // No existing issue, create new thread
        const forum = await discord.channels.fetch(FORUM_CHANNEL_ID);
        await forum.threads.create({
          name: `#${pull_request.number} - ${pull_request.title}`,
          message: {
            content: `**New Pull Request by ${sender.login}:** <${
              pull_request.html_url
            }>\n\n${pull_request.body || "No description"}`,
          },
        });
      }
    }

    // Handle comments on both issues and PRs
    else if (action === "created" && comment && issue) {
      const thread = await findThreadByIssueNumber(issue.number);
      if (thread) {
        await thread.send(
          `**${sender.login} commented:** <${comment.html_url}>\n\n${comment.body}`
        );
      }
    }

    // Handle closing/reopening/merging
    else if (action === "closed" || action === "reopened") {
      let thread;

      if (pull_request) {
        thread = await findThreadByIssueNumber(pull_request.number);
        if (thread) {
          if (action === "closed" && pull_request.merged) {
            await thread.send(`**${sender.login} merged this PR**`);
          } else {
            await thread.send(`**${sender.login} ${action} this PR**`);
          }
        }
      } else if (issue) {
        thread = await findThreadByIssueNumber(issue.number);
        if (thread) {
          await thread.send(`**${sender.login} ${action} this issue**`);
        }
      }
    }

    res.sendStatus(200);
  } catch (error) {
    console.error("Error:", error);
    res.sendStatus(500);
  }
});

discord.login(BOT_TOKEN);

app.listen(3000, () => {
  console.log("Webhook server running on port 3000");
});
