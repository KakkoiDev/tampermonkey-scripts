1. [DONE] Slack quick edit:
  - double-click your own message to enter edit mode
  - save with Cmd/Ctrl+Enter (Slack native); the original click-outside-to-save was dropped as redundant

2. Slack Self DM:
  - Like the forward option in the hover on message but will directly DM to myself without confirmation
  - new Slack-design-system-compliant arrow icon in the hover menu on messages
  - click sends copy of message directly without confirmation
  - Add a mention at the end of the DM with the link to the original message (parse to only leave the link to the latest message in case there are other origin links with our format). Format should be "Self DM from [this message](link-to-message)"

3. Slack Todo Emoji:
  - When double click on text input, insert :white_square: emoji
  - when cliking on an emoji, if it is part of the todo emoji system, update emoji to the next one in the loop
  - loop cycle is: :white_square: -> :arrow_forward: -> :white_check_mark: -> :double_vertical_bar: -> :x:
  - tabs now add 7 spaces
  - when pressing <Enter> to go to a new line, if a todo emoji is on that line: go the next line, keep space indent, auto-add a :white_square: emoji

4. [DONE] Slack Auto-remove Preview:
  - When a preview is detected, if I own it, click on the x to delete it.

5. Slack MarkItDown:
  - create a button in the header of channels, in the header of thread and in the hover menu of message to copy through MarkItDown. The goal is to preserve structure and links.
  - The button should only copy the content that we expect is to copy: channel, thread, message. Not the navigation or the right-side notification menu.

6. [DONE] GitHub Show/Copy PR diff:
  - in the top nav bar, next to "Files Changed", add a "Copy Diff" button
  - when pressing the button, briefly open a tab to pr-url.diff and copy it content to the clipboard
  - then close the tab.

7. GitHub Copy Title with Link to PR:
  - add a button similar to the one that copies the PR branch name. the button is place right after the pen button to edit the title
  - that button when clicked copies the PR title and the link [PR title](link)
  - let's confirm that this works both on Notion and Slack
  - the goal is to share links easily.

8. Notion Page Copy Title with Link to page:
  - add a button similar to the one that copies the PR branch name, but following the Notion design system. the button is placed right after the page title. 
  - that button when clicked copies the page title and the link [Page title](link)
  - let's confirm that this works both on Notion and Slack
  - the goal is to share links easily.

9. [DONE] When creating a script, add the target website favicon.
  - Check how it was done for previous scripts
  - add to both released scripts and local dev scripts (for better identification in the dashboard)
  - fix existing scripts (released and dev)

10. Improve the Slack translation script:
  - Add Anthropic + OpenAI key support (plus try to make it work for myself)
  - Add local model support
  - Add deterministic processing to ensure that the message's format will be preserved. Like a formating step before displaying to user.
  - Add "see original" button
  - Improve modal visual, make it look like a Slack modal
