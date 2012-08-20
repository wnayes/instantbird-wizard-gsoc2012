# Instantbird Account Import Wizard
### Google Summer of Code 2012

## About

This repository contains the final code I produced during the Google Summer of Code 2012 coding period. I worked with my mentor, [Florian Quèze](http://instantbird.com/about-flo.html), and the [Instantbird](http://www.instantbird.com/) development community to add account import functionality to the existing account wizard.

Here is my original abstract for the project:

    When evaluating a new messaging client, the common frustration of reconfiguring accounts and settings is difficult to avoid. To combat similar issues, the developers at Mozilla have implemented account import wizards in their Firefox and Thunderbird software packages. I propose creating an Account Import Wizard for the IM client Instantbird, which will provide users with a flexible way to import profile data from existing messaging client installations.
    
    Specifically, I plan to implement a wizard which will allow users to import not only their existing protocol credentials, but conversation logs as well. Providing account import will encourage adoption of the Instantbird client, while conversation log import will prevent the need to return to previous client software to recall important conversations.

## Results

A working patch providing the features described above was created. The ability to retrieve accounts from AIM, Windows Live Messenger, Google Talk, mIRC, Pidgin, and Colloquy was implemented. Parsing of log files from Pidgin and mIRC into the format used by Instantbird was added, which occurs when the user idles.

### Design

Here are some images of the final user interface.

#### Welcome Screen

When opening the wizard, the search for available accounts is performed and the result is displayed. The user may choose to skip importing accounts and create new ones instead.

![UI Welcome Screen](http://www.tc.umn.edu/~nayes006/gsoc2012/files/UIWelcomeScreenFinal.png)

#### Summary Screen

The accounts to be created are all listed on this page. If the user had chosen to view existing accounts, they would be listed here as well. Unchecking any account on this page will cancel its creation. Once looking over what was found and adding any other accounts desired, pressing Finish creates the accounts.

![UI Summary Screen with Found Accounts](http://www.tc.umn.edu/~nayes006/gsoc2012/files/UISummaryListImportablesFinal.png)

![UI Summary Screen 2](http://www.tc.umn.edu/~nayes006/gsoc2012/files/UISummaryListTypesFinal.png)

## Additional Information

I have added some header comments to the files in the repository to help explain their purpose and authorship.

As of now, this code is awaiting review before landing in the [Instantbird Nightly](http://ftp.instantbird.com/instantbird/nightly/latest-trunk/). I will have more information shortly on how to contribute to the code or report any bugs!
