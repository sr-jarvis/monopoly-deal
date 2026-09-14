const crypto = require("crypto");

class Card {
    id;
    title;
    value;
    imageLocation;

    constructor(title, value, id) {
        this.id = id || crypto.randomUUID();
        this.title = title;
        this.value = value;
        this.imageLocation = "assets/imgs/played_cards.png";
    }

    onPlay() {
        console.log("Playing " + this.title);
    }
}
module.exports = Card;
