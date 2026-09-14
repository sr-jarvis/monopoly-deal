const Card = require("./Card.js");

class MoneyCard extends Card {
    imageLocation;

    constructor(title, value) {
        super(title, value);
        this.kind = "MONEY";
        this.imageLocation = "assets/imgs/money_cards/" + title + ".png";
    }
}
module.exports = MoneyCard;
