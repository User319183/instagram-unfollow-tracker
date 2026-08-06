#!/bin/bash
set -e

echo "Step 1: Install GitHub CLI (if not already installed)"
brew install gh 2>/dev/null || echo "gh already installed or brew not available"

echo ""
echo "Step 2: Log in to GitHub (will open browser)"
echo "Run this manually: gh auth login"
echo ""

read -p "Press Enter after running 'gh auth login' and returning to this terminal..."

echo ""
echo "Step 3: Initialize and push repo"
cd ~/Desktop/instagram-unfollow-tracker

# Create .gitignore
cat > .gitignore << 'EOF'
.DS_Store
*.swp
*.swo
*~
EOF

git init
git add .
git commit -m "Initial commit: Instagram Unfollow Tracker v2.2"

echo ""
echo "Creating public GitHub repo and pushing..."
gh repo create instagram-unfollow-tracker --public --source=. --push

echo ""
echo "Done! Your repo is at: https://github.com/user319183/instagram-unfollow-tracker"
