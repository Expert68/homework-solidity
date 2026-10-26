// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

//用 solidity 实现整数转罗马数字
//用 solidity 实现罗马数字转数整数

contract RomanConverter {
    function intToRoman(uint256 num) public pure returns (string memory) {
        // 实现整数转罗马数字的逻辑
        require(num>0 && num<=3999, "num must be between 1 and 3999");
        //900=CM,400=CD,90=XC,40=XL,9=IX,4=IV
        uint256[13] memory values = [
            uint256(1000),900,500,400,100,90,50,40,10,9,5,4,1
        ];
        string[13] memory symbols = [
            "M","CM","D","CD","C","XC","L","XL","X","IX","V","IV","I"
        ];
       
       bytes memory out;
       for(uint256 i=0;i<13;i++) {
        while(num>=values[i]) {
            out = abi.encodePacked(out, bytes(symbols[i]));
            num-=values[i];
        }
       }
       return string(out);
    }
    
    function romanToInt(string memory s) public pure returns (uint256) {
        // 实现罗马数字转数整数的逻辑
        bytes memory b = bytes(s);
        require(b.length>0,"roman: empty string");

        uint256 total=0;
        uint256 prev=0;

        for(uint256 i=b.length;i>0;i--) {
            uint256 cur = _charValue(b[i-1]);

            if(cur<prev) {
                total-=cur;
            } else {
                total+=cur;
                prev=cur;
            }
        }
        return total;
    }
    
    function _charValue(bytes1 c) private pure returns (uint256) {
       if(c=="I") {
           return 1;
       } else if(c=="V") {
           return 5;
       } else if(c=="X") {
           return 10;
       } else if(c=="L") {
           return 50;
       } else if(c=="C") {
           return 100;
       } else if(c=="D") {
           return 500;
       } else if(c=="M") {
           return 1000;
       }
       revert("invalid roman character");
    }
}
