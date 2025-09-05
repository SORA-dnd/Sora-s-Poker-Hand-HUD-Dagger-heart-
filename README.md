# Sora-s-Poker-Hand-HUD-Dagger-heart-

About Card Images
Welcome to the module! To ensure free and safe usage for everyone, this module does not come with any built-in art assets. However, this gives you complete freedom to customize unique cards that fit your game's style!
The setup process is simple. You only need to prepare two main images: a Card Base Image and a Mask Image.
1. Card Base Image
What is it? This is the background frame for your card, like a blank card with a beautiful border.
What is it for?
It serves as the background for the final card face.
The background for cards in your hand will be this image.
Recommendations:
Use a common card aspect ratio, such as 600x840 pixels.
Save it as a PNG or WEBP file.
2. Mask Image
What is it? A simple black-and-white image that defines the shape of the main art area on your card.
How does it work?
The white areas of the mask will reveal your Item's main image.
The black or transparent areas will be treated as transparent, masking out the Item's image.
Example: If your mask is a white circle on a black background, all your card art will be cropped into a perfect circle.
Recommendations:
Its dimensions should be identical to your Card Base Image.
It must be a pure black-and-white image, with no shades of gray.
Save it as a PNG file.
Setup Instructions
1. Prepare Your Images:
Create or download the Card Base and Mask images that you like.
Upload these images to a location in your Foundry VTT Data folder (creating a new folder like data/my-card-assets/ is recommended).
2. Configure Module Settings:
In the game, navigate to Game Settings -> Configure Settings.
Find the settings section for this module.
3. Assign Image Paths:
Card Base Path: Click the Browse button and use the File Picker to select your uploaded Card Base Image.
Mask Path: Click Browse and select your uploaded Mask Image.
Custom Card Back
You can also upload a fully custom image to be used as the back of the cards. In the module settings, simply assign your chosen image to the Card Back Path option.

Poker-hand style item HUD with a customizable status bar, integrated assets, and visual effects.
You can open the HUD by clicking the bookmark button on the left side of the screen (the bookmark's position can be adjusted in the settings).If you don't have a token selected, the HUD will automatically display the first character you own (convenient for "theater of the mind" style play).If you are the GM, the HUD will display for your selected token (you may need to click the "Reset" button to refresh the character).



![角色和打开 00_00_00-00_00_30](https://github.com/user-attachments/assets/017fd6fb-c1c0-47a9-82d1-26cf8ffe82c6)

You can scroll through your cards using the mouse wheel. Use the top buttons (like Config, Items, etc.) to view different types of cards, and left-click any card to view its corresponding item sheet.
For "Domain Cards," you can right-click to select five cards and then click "Confirm" to build your "Domain Card Hand," which will sync with your character sheet. After your hand is confirmed, you can right-click a Domain Card to use it. For other items and features, you can always left-click to view them and right-click to use them.
You can double-click the token portrait in the center of the HUD to open your character sheet. You can also quickly modify some of your character's stats using the resource trackers to the left of the portrait.

![浏览 00_00_00-00_00_30](https://github.com/user-attachments/assets/d2c332e7-ee2a-47c4-adf8-1bc69b6f5669)
![领域卡 00_00_00-00_00_30](https://github.com/user-attachments/assets/1ea5a1ec-a5f6-4092-876e-014d62281713)
![数据 00_00_00-00_00_30](https://github.com/user-attachments/assets/7eb0bfc1-17b0-4a29-8ee2-09f6698c0e33)
You can switch between different card back and HUD background themes in the settings. Players have the option to either "Follow World" settings or choose their own local overrides.![传奇光效和火花 00_00_00-00_00_30](https://github.com/user-attachments/assets/b2e08518-15af-4b79-a8b6-ef7f33e987e8)
![卡背与UI图像 00_00_00-00_00_30](https://github.com/user-attachments/assets/5497f13a-f36d-46ee-9075-53411bf45296)
